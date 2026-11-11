export function readConfigDbSettings(env={}){
 if(env.TITAN_CONFIG_ENABLED!=='true')return null;
 const names={config:['TITAN_CONFIG_READ_DATABASE_URL','titan_config_api_login'],grants:['TITAN_CONFIG_GRANTS_DATABASE_URL','titan_config_grants_login']};
 const urls={};
 for(const [purpose,[field,principal]] of Object.entries(names)){
  const supplied=env[field];let parsed;
  try{parsed=new URL(supplied)}catch{throw Error('invalid '+purpose+' configuration database URL')}
  if(!['postgres:','postgresql:'].includes(parsed.protocol)||parsed.username!==principal||!parsed.password||
    !parsed.hostname||parsed.pathname==='/'||!parsed.pathname||parsed.hash||
    parsed.searchParams.get('sslmode')!=='verify-full'||!parsed.searchParams.get('sslrootcert'))
    throw Error('invalid '+purpose+' configuration database permissions');
  urls[purpose]=supplied;
 }
 if(urls.config===urls.grants)throw Error('shared configuration database credentials');
 return Object.freeze(urls);
}
