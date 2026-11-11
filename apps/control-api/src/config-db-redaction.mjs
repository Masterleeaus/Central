export function safeConfigDatabaseError(error){
 const code=typeof error?.code==='string'&&/^[A-Z0-9_]{1,20}$/.test(error.code)?error.code:'CONNECTION_FAILED';
 return Object.freeze({name:'config_database_unavailable',code});
}
