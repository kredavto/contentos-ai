import {DomainError} from '@contentos/types';

/** Version dispatch shares the existing authorization and service boundaries. */
export function apiRoutePath(segments:readonly string[]):string[]{
  const version=segments[0];
  if(version!=='v1'){
    if(version&&/^v[0-9]+$/.test(version))throw new DomainError('NOT_FOUND',404);
    return [...segments];
  }
  const path=segments.slice(1);
  if(!path.length||path[0]==='v1')throw new DomainError('NOT_FOUND',404);
  if(path.length===2&&path[0]==='auth'){
    if(path[1]==='verify-email')return ['auth','verify'];
    if(path[1]==='session')return ['me'];
  }
  return path;
}
