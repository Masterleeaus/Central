/** Report safe operational metadata without database names or credentials. */
export function classifyShutdown(results){
 if(!Array.isArray(results))throw Error('invalid shutdown results');
 const failed=results.filter(x=>x?.status==='rejected').length;
 return Object.freeze({complete:failed===0,failures:failed});
}
