export function centralListenPort(env={}){
 const raw=env.TITAN_CENTRAL_PORT??3102;
 if(typeof raw==='string'&&!/^[0-9]+$/.test(raw))throw Error('invalid port');
 const value=Number(raw);
 if(!Number.isSafeInteger(value)||value<1||value>65535)throw Error('invalid port');
 return value;
}
