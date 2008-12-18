/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Weave
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Dan Mills <thunder@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const EXPORTED_SYMBOLS = ['HistoryEngine'];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

Cu.import("resource://weave/log4moz.js");
Cu.import("resource://weave/util.js");
Cu.import("resource://weave/engines.js");
Cu.import("resource://weave/syncCores.js");
Cu.import("resource://weave/stores.js");
Cu.import("resource://weave/trackers.js");
Cu.import("resource://weave/async.js");

Function.prototype.async = Async.sugar;

function HistoryEngine() {
  this._init();
}
HistoryEngine.prototype = {
  __proto__: SyncEngine.prototype,
  get _super() SyncEngine.prototype,

  get name() "history",
  get displayName() "History",
  get logName() "History",
  get serverPrefix() "user-data/history/",

  get _store() {
    let store = new HistoryStore();
    this.__defineGetter__("_store", function() store);
    return store;
  },

  get _tracker() {
    let tracker = new HistoryTracker();
    this.__defineGetter__("_tracker", function() tracker);
    return tracker;
  }
};

function HistoryStore() {
  this._init();
}
HistoryStore.prototype = {
  __proto__: Store.prototype,
  _logName: "HistStore",
  _lookup: null,

  get _hsvc() {
    let hsvc = Cc["@mozilla.org/browser/nav-history-service;1"].
      getService(Ci.nsINavHistoryService);
    hsvc.QueryInterface(Ci.nsIGlobalHistory2);
    hsvc.QueryInterface(Ci.nsIBrowserHistory);
    hsvc.QueryInterface(Ci.nsPIPlacesDatabase);
    this.__defineGetter__("_hsvc", function() hsvc);
    return hsvc;
  },

  get _anno() {
    let anno = Cc["@mozilla.org/browser/annotation-service;1"].
      getService(Ci.nsIAnnotationService);
    this.__defineGetter__("_ans", function() anno);
    return anno;
  },

  get _histDB_30() {
    let file = Cc["@mozilla.org/file/directory_service;1"].
      getService(Ci.nsIProperties).
      get("ProfD", Ci.nsIFile);
    file.append("places.sqlite");
    let stor = Cc["@mozilla.org/storage/service;1"].
      getService(Ci.mozIStorageService);
    let db = stor.openDatabase(file);
    this.__defineGetter__("_histDB_30", function() db);
    return db;
  },

  get _db() {
    // FIXME
    //if (fx3.0)
    //  return this._histDB_30;
    //else
      return this._hsvc.DBConnection;
  },

  _fetchRow: function HistStore__fetchRow(stm, params, retparams) {
    try {
      for (let key in params) {
        stm.params[key] = params[key];
      }
      if (!stm.step())
        return null;
      if (retparams.length == 1)
        return stm.row[retparams[0]];
      let ret = {};
      for each (let key in retparams) {
        ret[key] = stm.row[key];
      }
      return ret;
    } finally {
      stm.reset();
    }
  },

  _defineStm: function HistStore__defineStm(prop, sql) {
    let stm = this._db.createStatement(sql);
    this.__defineGetter__(prop, function() stm);
    return stm;
  },

  get _visitStm() {
    let stm = this._defineStm(
      "_visitStm",
      "SELECT visit_type AS type, visit_date AS date " +
        "FROM moz_historyvisits " +
        "WHERE place_id = :placeid " +
        "ORDER BY visit_date DESC");
    return stm;
  },

  get _pidStm() {
    let stm = this._defineStm(
      "_pidStm", "SELECT id FROM moz_places WHERE url = :url");
    return stm;
  },

  get _urlStm() {
    let stm = this._defineStm(
      "_urlStm", "SELECT url FROM moz_places WHERE id = :id");
    return stm;
  },

  get _annoAttrIdStm() {
    let stm = this._defineStm(
      "_annoAttrIdStm",
      "SELECT id from moz_anno_attributes WHERE name = :name");
    return stm;
  },

  get _findPidByAnnoStm() {
    let stm = this._defineStm(
      "_findPidByAnnoStm",
      "SELECT place_id AS id FROM moz_annos " +
        "WHERE anno_attribute_id = :attr AND content = :content");
    return stm;
  },

  // See bug 320831 for why we use SQL here
  _getVisits: function HistStore__getVisits(uri) {
    if (typeof(uri) != "string")
      uri = uri.spec;
    let placeid = this._fetchRow(this._pidStm, {url: uri}, ['id']);

    this._visitStm.params.placeid = placeid;
    let i = 0;
    let visits = [];
    while (this._visitStm.step()) {
      visits.push({date: this._visitStm.row.date,
                   type: this._visitStm.row.type});
      if (++i > 10)
        break;
    }
    this._visitStm.reset();
    return visits;
  },

  _getGUID: function HistStore__getGUID(uri) {
    if (typeof(uri) == "string")
      uri = Utils.makeURI(uri);
    try {
      return this._anno.getPageAnnotation(uri, "weave/guid");
    } catch (e) {
      // FIXME
      // if (e != NS_ERROR_NOT_AVAILABLE)
      // throw e;
    }
    let guid = Utils.makeGUID();
    this._anno.setPageAnnotation(uri, "weave/guid", guid, 0, this._anno.EXPIRE_WITH_HISTORY);
    return guid;
  },

  // See bug 468732 for why we use SQL here
  _findURLByGUID: function HistStore__findByGUID(guid) {
    try {
      this._annoAttrIdStm.params.name = "weave/guid";
      if (!this._annoAttrIdStm.step())
        return null;
      let annoId = this._annoAttrIdStm.row.id;

      this._findPidByAnnoStm.params.attr = annoId;
      this._findPidByAnnoStm.params.content = guid;
      if (!this._findPidByAnnoStm.step())
        return null;
      let placeId = this._findPidByAnnoStm.row.id;

      this._urlStm.params.id = placeId;
      if (!this._urlStm.step())
        return null;

      return this._urlStm.row.url;
    } finally {
      this._annoAttrIdStm.reset();
      this._findPidByAnnoStm.reset();
      this._urlStm.reset();
    }
  },

  changeItemID: function HStore_changeItemID(oldID, newID) {
    let uri = Utils.makeURI(this._findURLByGUID(oldID));
    this._anno.setPageAnnotation(uri, "weave/guid", newID, 0, 0);
  },

  // XXX need a better way to query Places for all GUIDs
  getAllIDs: function BStore_getAllIDs() {
    let all = this.wrap();
    return all;
  },

  create: function HistStore_create(record) {
    this._log.debug("  -> creating history entry: " + record.cleartext.URI);

    let uri = Utils.makeURI(record.cleartext.URI);

    let visit;
    while ((visit = record.cleartext.visits.pop())) {
      this._log.debug("     visit " + visit.time);
      this._hsvc.addVisit(uri, visit.time, null, visit.type,
                          (visit.type == 5 || visit.type == 6), 0);
    }
    this._hsvc.setPageTitle(uri, record.cleartext.title);
  },

  remove: function HistStore_remove(record) {
    this._log.trace("  -> NOT removing history entry: " + record.id);
    // FIXME: implement!
  },

  update: function HistStore_update(record) {
    this._log.trace("  -> FIXME: NOT editing history entry: " + record.id);
    // FIXME: implement!
  },

  wrap: function HistStore_wrap() {
    let query = this._hsvc.getNewQuery(),
        options = this._hsvc.getNewQueryOptions();

    query.minVisits = 1;
    options.maxResults = 100;
    options.sortingMode = options.SORT_BY_DATE_DESCENDING;
    options.queryType = options.QUERY_TYPE_HISTORY;

    let root = this._hsvc.executeQuery(query, options).root;
    root.QueryInterface(Ci.nsINavHistoryQueryResultNode);
    root.containerOpen = true;

    let items = {};
    for (let i = 0; i < root.childCount; i++) {
      let item = root.getChild(i);
      let guid = this._getGUID(item.uri);
      items[guid] = {title: item.title,
		     URI: item.uri,
                     visits: this._getVisits(item.uri)};
    }

    return items;
  },

  wrapItem: function HistStore_wrapItem(id) {
    // FIXME: use findURLByGUID! (not so important b/c of cache hints though)
    if (this._itemCache)
      return this._itemCache[id];
    let all = this._wrap();
    return all[id];
  },

  wipe: function HistStore_wipe() {
    this._hsvc.removeAllPages();
  }
};

function HistoryTracker() {
  this._init();
}
HistoryTracker.prototype = {
  __proto__: Tracker.prototype,
  _logName: "HistoryTracker",

  QueryInterface: XPCOMUtils.generateQI([Ci.nsINavHistoryObserver]),

  get _hsvc() {
    let hsvc = Cc["@mozilla.org/browser/nav-history-service;1"].
      getService(Ci.nsINavHistoryService);
    this.__defineGetter__("_hsvc", function() hsvc);
    return hsvc;
  },

  // FIXME: hack!
  get _store() {
    let store = new HistoryStore();
    this.__defineGetter__("_store", function() store);
    return store;
  },

  _init: function HT__init() {
    this.__proto__.__proto__._init.call(this);
    this._hsvc.addObserver(this, false);
  },

  onBeginUpdateBatch: function HT_onBeginUpdateBatch() {},
  onEndUpdateBatch: function HT_onEndUpdateBatch() {},
  onPageChanged: function HT_onPageChanged() {},
  onTitleChanged: function HT_onTitleChanged() {},

  /* Every add or remove is worth 1 point.
   * Clearing the whole history is worth 50 points (see below)
   */
  _upScore: function BMT__upScore() {
    if (!this.enabled)
      return;
    this._score += 1;
  },

  onVisit: function HT_onVisit(uri, vid, time, session, referrer, trans) {
    this._log.trace("onVisit: " + uri.spec);
    this.addChangedID(this._store._getGUID(uri));
    this._upScore();
  },
  onPageExpired: function HT_onPageExpired(uri, time, entry) {
    this._log.trace("onPageExpired: " + uri.spec);
    this.addChangedID(this._store._getGUID(uri)); // XXX eek ?
    this._upScore();
  },
  onDeleteURI: function HT_onDeleteURI(uri) {
    this._log.trace("onDeleteURI: " + uri.spec);
    this.addChangedID(this._store._getGUID(uri)); // FIXME eek
    this._upScore();
  },
  onClearHistory: function HT_onClearHistory() {
    this._log.trace("onClearHistory");
    this._score += 50;
  }
};
