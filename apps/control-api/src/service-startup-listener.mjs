/** Attach and remove a one-shot error listener; failures are propagated to
 * the caller to perform database-pool cleanup. */
export async function listenCentral(server,port){
 if(typeof server?.listen!=='function'||!Number.isSafeInteger(port)||port<1||port>65535)
  throw Error('invalid listener configuration');
 await new Promise((resolve,reject)=>{
  const failure=error=>{server.off('listening',ready);reject(error)};
  const ready=()=>{server.off('error',failure);resolve()};
  server.once('error',failure);
  server.once('listening',ready);
  try{server.listen(port,'127.0.0.1')}catch(error){server.off('error',failure);server.off('listening',ready);reject(error)}
 });
}
