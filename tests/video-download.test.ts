import {describe,it,expect} from 'vitest';
import {checkedVideoUrl,isPublicVideoAddress} from '../packages/providers/src/video-download';
describe('provider video download boundary',()=>{
  it('requires the exact HTTPS provider host without credentials or alternate ports',()=>{
    expect(checkedVideoUrl('https://files.heygen.ai/video.mp4?signature=fixture',['files.heygen.ai']).hostname).toBe('files.heygen.ai');
    for(const url of ['http://files.heygen.ai/a','https://files.heygen.ai.evil.test/a','https://user:pass@files.heygen.ai/a','https://files.heygen.ai:8443/a','https://127.0.0.1/a','file:///etc/passwd','https://files.heygen.ai/a#fragment'])expect(()=>checkedVideoUrl(url,['files.heygen.ai'])).toThrow('INVALID_MEDIA');
  });
  it('denies private, loopback, link-local, reserved and IPv6 destinations',()=>{
    for(const address of ['0.0.0.0','10.1.2.3','127.0.0.1','169.254.169.254','172.16.0.1','172.31.255.255','192.168.1.1','100.64.0.1','198.18.0.1','192.0.2.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1','::ffff:127.0.0.1','invalid'])expect(isPublicVideoAddress(address)).toBe(false);
    expect(isPublicVideoAddress('8.8.8.8')).toBe(true);
  });
});
