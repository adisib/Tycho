/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 *
 * The contents of this file are subject to the Netscape Public
 * License Version 1.1 (the "License"); you may not use this file
 * except in compliance with the License. You may obtain a copy of
 * the License at http://www.mozilla.org/NPL/
 *
 * Software distributed under the License is distributed on an "AS
 * IS" basis, WITHOUT WARRANTY OF ANY KIND, either express or
 * implied. See the License for the specific language governing
 * rights and limitations under the License.
 *
 * The Original Code is mozilla.org code.
 *
 * The Initial Developer of the Original Code is Netscape
 * Communications Corporation.  Portions created by Netscape are
 * Copyright (C) 1998 Netscape Communications Corporation. All
 * Rights Reserved.
 *
 * Contributor(s): 
 *   Pierre Phaneuf <pp@ludusdesign.com>
 */


#include "nsTimerMotif.h"

#include "nsUnixTimerCIID.h"

#include "nsIFactory.h"
#include "nsIComponentManager.h"
#include "nsIServiceManager.h"
#include "nsCOMPtr.h"
#include "nslog.h"

NS_IMPL_LOG(nsTimerMotifFactoryLog, 0)
#define PRINTF NS_LOG_PRINTF(nsTimerMotifFactoryLog)
#define FLUSH  NS_LOG_FLUSH(nsTimerMotifFactoryLog)

static NS_DEFINE_CID(kCTimerMotif, NS_TIMER_MOTIF_CID);
static NS_DEFINE_CID(kComponentManagerCID, NS_COMPONENTMANAGER_CID);

class nsTimerMotifFactory : public nsIFactory
{
public:
  NS_DECL_ISUPPORTS

  NS_IMETHOD CreateInstance(nsISupports *aOuter,
                            const nsIID &aIID,
                            void **aResult);

  NS_IMETHOD LockFactory(PRBool aLock);

  nsTimerMotifFactory(const nsCID &aClass);
  virtual ~nsTimerMotifFactory();

private:
  nsCID mClassID;

};

nsTimerMotifFactory::nsTimerMotifFactory(const nsCID &aClass) :
  mRefCnt(0),
  mClassID(aClass)
{   
}   

nsTimerMotifFactory::~nsTimerMotifFactory()   
{   
}   

NS_IMPL_ISUPPORTS(nsTimerMotifFactory, NS_GET_IID(nsIFactory))


NS_IMETHODIMP
nsTimerMotifFactory::CreateInstance(nsISupports *aOuter,  
                                const nsIID &aIID,  
                                void **aResult)  
{  
  if (aResult == nsnull)
    return NS_ERROR_NULL_POINTER;  

  *aResult = nsnull;  
  
  nsISupports *inst = nsnull;

  if (mClassID.Equals(kCTimerMotif)) 
  {
    inst = (nsISupports *)(nsTimerMotif *) new nsTimerMotif();
  }

  if (inst == nsnull) 
    return NS_ERROR_OUT_OF_MEMORY;
  
  nsresult rv = inst->QueryInterface(aIID, aResult);

  if (rv != NS_OK) 
    delete inst;
  
  return rv;
}

nsresult nsTimerMotifFactory::LockFactory(PRBool aLock)
{
  // Not implemented in simplest case.  
  return NS_OK;
}

nsresult
NSGetFactory(nsISupports* servMgr,
             const nsCID &aClass,
             const char *aClassName,
             const char *aContractID,
             nsIFactory **aFactory)
{
  if (nsnull == aFactory) {
    return NS_ERROR_NULL_POINTER;
  }

  *aFactory = new nsTimerMotifFactory(aClass);

  if (nsnull == aFactory) {
    return NS_ERROR_OUT_OF_MEMORY;
  }

  return (*aFactory)->QueryInterface(NS_GET_IID(nsIFactory), (void**)aFactory);
  
}

PRBool
NSCanUnload(nsISupports* aServMgr)
{
  return PR_FALSE;
}

nsresult
NSRegisterSelf(nsISupports* aServMgr, const char *fullpath)
{
  nsresult rv;

#ifdef NS_DEBUG
  PRINTF("*** Registering MOTIF timer\n");
#endif

  nsCOMPtr<nsIServiceManager>
    serviceManager(do_QueryInterface(aServMgr, &rv));
  if (NS_FAILED(rv)) return rv;
  
  NS_WITH_SERVICE(nsIComponentManager, compMgr, kComponentManagerCID, &rv);
  if (NS_FAILED(rv)) return rv;

  rv = compMgr->RegisterComponent(kCTimerMotif,
                                  "MOTIF timer",
                                  "@mozilla.org/timer/unix/motif;1",
                                  fullpath,
                                  PR_TRUE, 
                                  PR_TRUE);
  
  return rv;
}

nsresult
NSUnregisterSelf(nsISupports* aServMgr, const char *fullpath)
{

  nsresult rv;
  nsCOMPtr<nsIServiceManager>
    serviceManager(do_QueryInterface(aServMgr, &rv));
  if (NS_FAILED(rv)) return rv;
  
  NS_WITH_SERVICE(nsIComponentManager, compMgr, kComponentManagerCID, &rv);
  if (NS_FAILED(rv)) return rv;

  compMgr->UnregisterComponent(kCTimerMotif, fullpath);
  
  return NS_OK;
}
