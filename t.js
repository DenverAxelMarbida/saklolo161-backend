const axios = require('D:/VScode codes/Saklolo161/saklolo161-backend/node_modules/axios');
const BASE='http://localhost:5999';
(async()=>{
  try{
    const r = await axios.post(BASE+'/api/auth/login',{email:'admin@marikina.gov.ph',password:'changeme123'});
    console.log('LOGIN OK:', JSON.stringify(r.data));
    global.token = r.data?.data?.token;
  }catch(e){ console.log('LOGIN ERR', e.response?.status, JSON.stringify(e.response?.data)); }
})().catch(e=>console.log('CONN ERR', e.message));
