/** AES-256-GCM sealing for OIDC login-state secrets (PKCE verifier and nonce) at rest.
 * Key comes from TITAN_OIDC_STATE_KEY (base64, exactly 32 bytes). There is no default
 * key: construction fails when the variable is missing or malformed.
 * The AAD binds each ciphertext to its application, state digest and field, so a sealed
 * value cannot be moved to another row or column without failing authentication. */
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
export const STATE_KEY_ENV='TITAN_OIDC_STATE_KEY';
const PREFIX='v1.';
const IV_BYTES=12, TAG_BYTES=16;
const b64url=buf=>buf.toString('base64url');

export function parseStateKey(value) {
  if(typeof value!=='string'||value.length===0) throw new TypeError(`${STATE_KEY_ENV} must be set`);
  const key=Buffer.from(value,'base64');
  if(key.length!==32||key.toString('base64')!==value) throw new TypeError(`${STATE_KEY_ENV} must be base64 encoding of 32 bytes`);
  return key;
}

export function createStateSealer({key}={}) {
  if(!Buffer.isBuffer(key)||key.length!==32) throw new TypeError('32-byte key required');
  return {
    seal(plaintext,aad) {
      if(typeof plaintext!=='string'||plaintext.length===0||typeof aad!=='string'||aad.length===0) throw new TypeError('invalid seal input');
      const iv=randomBytes(IV_BYTES);
      const cipher=createCipheriv('aes-256-gcm',key,iv,{authTagLength:TAG_BYTES});
      cipher.setAAD(Buffer.from(aad,'utf8'));
      const ciphertext=Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()]);
      return PREFIX+b64url(Buffer.concat([iv,cipher.getAuthTag(),ciphertext]));
    },
    open(sealed,aad) {
      if(typeof sealed!=='string'||!sealed.startsWith(PREFIX)||typeof aad!=='string') throw new Error('sealed value rejected');
      const raw=Buffer.from(sealed.slice(PREFIX.length),'base64url');
      if(raw.length<IV_BYTES+TAG_BYTES+1) throw new Error('sealed value rejected');
      const iv=raw.subarray(0,IV_BYTES), tag=raw.subarray(IV_BYTES,IV_BYTES+TAG_BYTES), ciphertext=raw.subarray(IV_BYTES+TAG_BYTES);
      const decipher=createDecipheriv('aes-256-gcm',key,iv,{authTagLength:TAG_BYTES});
      decipher.setAAD(Buffer.from(aad,'utf8'));
      decipher.setAuthTag(tag);
      try {
        return Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8');
      } catch { throw new Error('sealed value rejected'); }
    }
  };
}

/** Builds a sealer from the environment. Throws when the key is unset or malformed. */
export function createStateSealerFromEnv(env=process.env) {
  return createStateSealer({key:parseStateKey(env[STATE_KEY_ENV])});
}
