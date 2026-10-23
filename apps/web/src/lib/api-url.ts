/** Canonical application API routes; OAuth callbacks/webhooks have separate registered URLs. */
export function apiUrl(path:string){
  const canonical=path==='me'?'auth/session':path==='auth/verify'?'auth/verify-email':path;
  return `/api/v1/${canonical}`;
}
