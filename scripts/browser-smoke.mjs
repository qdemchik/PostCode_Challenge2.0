import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const tempRoot=resolve(tmpdir());
const dir=resolve(mkdtempSync(join(tempRoot,'postcode-browser-')));
const port=39000+Math.floor(Math.random()*3000);
const debugPort=port+1;
const base='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['server/dist/index.js'],{
 env:{...process.env,PORT:String(port+2),POSTCODE_SESSION_FILE:join(dir,'state.json')},windowsHide:true,stdio:'ignore'
});
const dist=resolve('web/dist');
const http=createServer(async(req,res)=>{
 try{
  if(req.url.startsWith('/api/')){
   const chunks=[]; for await(const c of req)chunks.push(c);
   const body=Buffer.concat(chunks);
   const remote=await fetch('http://127.0.0.1:'+(port+2)+req.url,{
    method:req.method,
    headers:{
     ...(body.length ? {'Content-Type':'application/json'} : {}),
     ...(req.headers['x-postcode-trip'] ? {'x-postcode-trip':req.headers['x-postcode-trip']} : {}),
    },
    body:body.length?body:undefined
   });
   res.writeHead(remote.status,{'Content-Type':'application/json'}).end(Buffer.from(await remote.arrayBuffer()));return;
  }
  const ext=req.url.endsWith('.js')?'js':req.url.endsWith('.css')?'css':'html';
  const path=ext==='html'?join(dist,'index.html'):resolve(dist,'.'+req.url);
  if(!path.startsWith(dist+sep))throw Error('Invalid path');
  res.writeHead(200,{'Content-Type':{js:'text/javascript',css:'text/css',html:'text/html'}[ext]}).end(readFileSync(path));
 }catch(e){res.writeHead(500).end(String(e));}
});
let edge,ws;
async function wait(action, label){
 const end=Date.now()+8500; let last; while(Date.now()<end){try{const result=await action();if(result)return result;}catch(e){last=e;} await delay(8);} if(last)console.error(last.message);
 throw Error('Timed out: '+label);
}
try{
 await new Promise(done=>http.listen(port,'127.0.0.1',done));
 await wait(async()=>(await fetch(base+'/api/health')).ok,'API');
 edge=spawn(process.env.BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
  '--headless=new','--window-size=1440,1000','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--user-data-dir='+join(dir,'edge'),'--remote-debugging-port='+debugPort,'about:blank'
 ],{windowsHide:true,stdio:'ignore'});
 edge.on('error', (error) => console.error('Не удалось запустить браузер. Проверьте BROWSER_PATH.', error.message));
 const target=await wait(async()=>{
  if(edge.exitCode!==null)throw Error('Browser exited '+edge.exitCode);
  const all=await(await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();
  return all.find(x=>x.type==='page');
 },'Edge CDP');
 console.log('Browser connected'); ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((yes,no)=>{ws.addEventListener('open',yes,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map();
 ws.addEventListener('message',({data})=>{const reply=JSON.parse(data);const resolve=pending.get(reply.id);if(resolve){pending.delete(reply.id);resolve(reply);}});
 async function cdp(method,params={}){
  const id=++seq;
  const result=new Promise(done=>pending.set(id,done));
  ws.send(JSON.stringify({id,method,params}));
  const timeout=setTimeout(()=>{ pending.get(id)?.({error:{message:'CDP timeout '+method}}); pending.delete(id); },4000); const reply=await result; clearTimeout(timeout);
  if(reply.error)throw Error(reply.error.message);
  return reply.result;
 }
 async function evaluate(expression){
  const v=await cdp('Runtime.evaluate',{expression,returnByValue:true});
  if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));
  return v.result.value;
 }
 async function click(expression,label){
  await wait(()=>evaluate('Boolean('+expression+')'),label);
  await evaluate('('+expression+').click()'); console.log(label);
 }
 const button=(selector,text)=>'Array.from(document.querySelectorAll('+JSON.stringify(selector)+')).find(b=>!b.disabled&&b.textContent.includes('+JSON.stringify(text)+'))';
 const navigate=async path=>{await cdp('Page.navigate',{url:base+path});await wait(()=>evaluate('location.pathname==='+JSON.stringify(path)+'&&document.readyState==="complete"'),'route '+path);};
 console.log('WebSocket connected'); await navigate('/scan');
 await wait(()=>evaluate('Boolean(document.querySelector("#scan"))'),'scan screen');
 await evaluate('(()=>{const i=document.querySelector("#scan");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,"IN261116000001");i.dispatchEvent(new Event("input",{bubbles:true}));})()');
 await click(button('button','Найти отправление'),'lookup');
 await wait(() => evaluate('Boolean(document.querySelector("input[name=notes]"))'), 'review fields');
 await evaluate(`(() => {
  const field = document.querySelector('input[name=notes]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'Smoke draft');
  field.dispatchEvent(new Event('input', { bubbles: true }));
 })()`);
 await navigate('/scan');
 await wait(() => evaluate('document.querySelector("input[name=notes]")?.value === "Smoke draft"'), 'review draft retained');
 for (const mark of ['careful', 'thermal']) {
   const checkbox = 'document.querySelector("input[name=mark-' + mark + ']")';
   await click(checkbox, 'set mark ' + mark);
 }
 await click(button('form button','Подтвердить и вложить'),'confirm shipment');
 const shipment=await wait(async()=>{
  const data=await(await fetch(base+'/api/shipments/IN261116000001')).json();
  return data.status==='placed'&&data;
 },'assignment');
 await navigate('/containers');
 await click(button('button',shipment.containerId),'container selection');
 await click(button('button','Изменить реквизиты'),'edit packaging');
 await evaluate(`(() => {
   const model = document.querySelector('select[name="packagingModel"]');
   const available = Array.from(model.options).find(option => option.value !== model.value);
   if (!available) throw Error('No alternate packaging model');
   model.value = available.value;
   model.dispatchEvent(new Event('change', { bubbles: true }));
 })()`);
 await click(button('form button','Сохранить'),'save alternate packaging model');
 await wait(async () => {
  const detail = await (await fetch(base + '/api/containers/' + shipment.containerId)).json();
  return detail.tareWeightGrams === 110 && detail.maxWeightGrams === 10_000;
 }, 'new tare and reference limit');
 await click(button('button','Закрыть ёмкость'),'close container');
 const link='document.querySelector('+JSON.stringify('a[href="/print/label/'+shipment.containerId+'"]')+')';
 await click(link,'label preview');
 await wait(() => evaluate('document.querySelector("article")?.textContent.includes("Терморежим, Осторожно")'), 'combined marks printed');
 await wait(()=>evaluate('(()=>{const canvas=document.querySelector("canvas");return canvas&&canvas.getContext("2d").getImageData(0,0,canvas.width,1).data.some((x,i)=>i%4===3&&x===255);})()'),'barcode drawn');
 await evaluate('window.print=()=>{}');
 await click(button('button','Печать / PDF'),'open label print dialog');
 await click(button('button','Подтвердить бумажный экземпляр'),'confirm paper label');
 await wait(()=>evaluate('Array.from(document.querySelectorAll("[role=status]")).some(e=>e.textContent.includes("Получение бумажного экземпляра подтверждено"))'),'label job complete');
 const labelPdf=await cdp('Page.printToPDF',{preferCSSPageSize:true});
 if(!Buffer.from(labelPdf.data,'base64').subarray(0,4).equals(Buffer.from('%PDF')))throw Error('Label PDF invalid');
 await navigate('/finish');
 await click(button('button','Сформировать ф.23а'),'waybill formation');
 const waybill=await wait(async()=>{
  const data=await(await fetch(base+'/api/waybills')).json();
  return data.items?.[0];
 },'waybill created');
 await click('document.querySelector('+JSON.stringify('a[href="/print/waybill/'+waybill.id+'"]')+')','waybill preview');
 await evaluate('window.print=()=>{}');
 await click(button('button','Печать / PDF'),'open waybill print dialog');
 await click(button('button','Подтвердить бумажный экземпляр'),'confirm paper waybill');
 await wait(()=>evaluate('Array.from(document.querySelectorAll("[role=status]")).some(e=>e.textContent.includes("Получение бумажного экземпляра подтверждено"))'),'waybill job complete');
 const waybillPdf=await cdp('Page.printToPDF',{preferCSSPageSize:true});
 if(!Buffer.from(waybillPdf.data,'base64').subarray(0,4).equals(Buffer.from('%PDF')))throw Error('Waybill PDF invalid');
 await navigate('/finish');
 await click(button('button','Подтвердить готовность'),'mark ready');
 await wait(()=>evaluate('Array.from(document.querySelectorAll(".badge")).some(e=>e.textContent.includes("Готово к вывозу"))'),'ready status');
 await click(button('a','Сверить и передать'),'open handover');
 const submit=button('button','Сверить');
 const scan=async(value)=>{
  await wait(()=>evaluate('Boolean(document.querySelector("#handover-code"))'),'handover field');
  await evaluate('(()=>{const i=document.querySelector("#handover-code");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,'+JSON.stringify(value)+');i.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await click(submit,'scan '+value);
 };
 const confirm=button('button','Подтвердить передачу водителю');
 if(await evaluate('Boolean('+confirm+')'))throw Error('Handover allowed without counts');
 await scan('0000000000000000'); await scan(shipment.containerId); await scan(shipment.containerId);
 if(await evaluate('Boolean('+confirm+')'))throw Error('Handover allowed with extra container');
 await navigate('/finish/' + waybill.id + '/handover');
 await wait(() => evaluate('document.body.textContent.includes("Сверено: 1 из 1") && document.body.textContent.includes("Лишние: 1")'), 'handover draft retained');
 await click(button('button','Убрать из сверки'),'remove foreign container');
 await click(confirm,'confirm handover');
 await wait(()=>evaluate('Array.from(document.querySelectorAll("[role=status]")).some(e=>e.textContent.includes("Передано водителю"))'),'handover success');
 await navigate('/finish');
 await wait(()=>evaluate('Array.from(document.querySelectorAll(".badge")).some(e=>e.textContent==="Передано водителю")'),'handover in summary');
 console.log('Browser workflow, paper confirmation, foreign/duplicate scan and handover verified');

 for (const width of [320, 390, 768]) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
  for (const path of ['/', '/scan', '/containers', '/finish', '/demo', '/search', '/print']) {
   await navigate(path);
   await wait(() => evaluate(`(() => {
     const root = document.documentElement;
     const main = document.querySelector('.app-main');
     const nav = document.querySelector('.app-header nav');
     return !!main?.querySelector('.trip-picker') && !!nav && root.clientWidth === ${width}
       && root.scrollWidth <= root.clientWidth + 1
       && nav.getBoundingClientRect().right <= root.clientWidth;
   })()`), 'responsive layout ' + width + 'px ' + path);
  }
 }
 await cdp('Emulation.clearDeviceMetricsOverride');
 console.log('Responsive layout verified at 320, 390 and 768 CSS pixels');

 const tripSelector = '.trip-picker [data-trip-id][aria-pressed="true"]';
 const inputValue = (selector, value) => evaluate(`(() => {
   const input = document.querySelector(${JSON.stringify(selector)});
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
   input.dispatchEvent(new Event('input', { bubbles: true }));
 })()`);
 const chooseTrip = (id) => evaluate(`(() => {
   const trip = [...document.querySelectorAll('.trip-picker [data-trip-id]')]
     .find((item) => item.dataset.tripId === ${JSON.stringify(id)});
   trip.click();
 })()`);
 await navigate('/');
 await wait(() => evaluate(`(() => {
   const grid = document.querySelector('.grid-4');
   if (!grid) return false;
   const cards = [...grid.children].map((card) => card.getBoundingClientRect());
   const near = (a, b) => Math.abs(a - b) < 1;
   const buttons = [...document.querySelectorAll('.page-stack .btn')].map((button) => button.getBoundingClientRect());
   return buttons.length > 1 && buttons.every((button) => near(button.width, 240) && near(button.height, 48))
     && cards.length === 4 && cards.every((card) => near(card.top, cards[0].top))
     && near(cards[0].left, 50) && near(document.documentElement.clientWidth - cards[3].right, 50)
     && cards.slice(1).every((card, index) => near(card.left - cards[index].right, 40))
     && !document.querySelector('.trip-picker select, .logo-mark');
 })()`), 'four-column desktop grid');
 const createTrip = async (name) => {
  await click(button('button','Новый рейс'), 'new trip');
  await wait(() => evaluate(`(() => {
    const form = document.querySelector('.trip-form');
    if (!form) return false;
    const [input, ...buttons] = [...form.querySelectorAll('input, button')].map((item) => item.getBoundingClientRect());
    return buttons.length === 2 && buttons.every((item) => Math.abs(item.top - input.top) < 1
      && Math.abs(item.bottom - input.bottom) < 1);
  })()`), 'trip form controls aligned');
  await inputValue('.trip-picker input', name);
  await click(button('button','Создать рейс'), 'save trip');
  const option = `document.querySelector(${JSON.stringify(tripSelector)})`;
  return wait(async () => {
   const selected = await evaluate(`(${option})?.textContent === ${JSON.stringify(name)} && (${option})?.dataset.tripId`);
   return selected;
  }, 'active trip ' + name);
 };
 const placeInTrip = async (barcode) => {
  await navigate('/scan');
  await wait(() => evaluate('Boolean(document.querySelector("#scan"))'), 'scan screen');
  await inputValue('#scan', barcode);
  await click(button('button','Найти отправление'), 'lookup ' + barcode);
  await click(button('form button','Подтвердить и вложить'), 'assign ' + barcode);
  return wait(async () => {
   const item = await (await fetch(base + '/api/shipments/' + barcode)).json();
   return item.status === 'placed' && item;
  }, 'placed ' + barcode);
 };
 const list = await (await fetch(base + '/api/shipments?eligible=true&limit=60')).json();
 const fixtures = list.items.filter((item) => !item.containerId && !item.routingIssue && item.address && item.city).slice(0, 2);
 if (fixtures.length !== 2) throw Error('Missing trip fixtures');
 const firstTrip = await createTrip('Утренний');
 await click(button('button','Переименовать'), 'rename active trip');
 await inputValue('.trip-picker input', 'Утренний рейс');
 await click(button('button','Сохранить название'), 'save trip name');
 await wait(() => evaluate('document.querySelector(".trip-option[aria-pressed=true]")?.textContent === "Утренний рейс"'), 'updated trip name');
 await navigate('/');
 await wait(() => evaluate('document.querySelector(".trip-option[aria-pressed=true]")?.textContent === "Утренний рейс"'), 'persisted trip name');
 await click(button('a', 'План рейса'), 'open trip plan');
 await wait(() => evaluate('Boolean(document.querySelector("#plan-code"))'), 'plan barcode control');
 await inputValue('#plan-code', fixtures[0].barcode);
 await click(button('button', 'Включить в план'), 'add shipment to first plan');
 await wait(() => evaluate('document.querySelector("table")?.textContent.includes(' + JSON.stringify(fixtures[0].barcode) + ')'), 'planned shipment visible');
 const secondTrip = await createTrip('Вечерний');
 await navigate('/scan');
 await wait(() => evaluate('Boolean(document.querySelector("#scan"))'), 'scan screen');
 await inputValue('#scan', fixtures[0].barcode);
 await click(button('button', 'Найти отправление'), 'look up shipment from another trip');
 await wait(() => evaluate('Array.from(document.querySelectorAll("[role=alert]")).some(element => element.textContent.includes("Утренний"))'), 'wrong trip warning');
 if (await evaluate('Boolean(' + button('form button', 'Подтвердить и вложить') + ')')) throw Error('Wrong trip allowed assignment');
 await click(button('button', 'К сканированию'), 'continue scanning');
 const secondShipment = await placeInTrip(fixtures[1].barcode);
 await chooseTrip(firstTrip);
 const firstShipment = await placeInTrip(fixtures[0].barcode);
 await chooseTrip(secondTrip);
 if (firstTrip === secondTrip || firstShipment.containerId === secondShipment.containerId) throw Error('Trips mixed');
 await navigate('/containers');
 await click(button('button', secondShipment.containerId), 'second trip retained after navigation');
 await chooseTrip(firstTrip);
 await wait(() => evaluate('Boolean(' + button('button', firstShipment.containerId) + ')'), 'first trip container');
 if (await evaluate('Boolean(' + button('button', secondShipment.containerId) + ')')) throw Error('Foreign container displayed');
 await click(button('button', firstShipment.containerId), 'open first trip container');
 await click(button('button', 'Закрыть ёмкость'), 'close first trip container');
 await navigate('/finish');
 await click(button('button', 'Сформировать ф.23а'), 'form trip waybill');
 const tripDocuments = async () => (await (await fetch(base + '/api/waybills', {
  headers: { 'x-postcode-trip': firstTrip },
 })).json()).items;
 const original = await wait(async () => (await tripDocuments())[0], 'trip waybill');
 await click(button('button', 'Аннулировать'), 'cancel trip waybill');
 await inputValue('form input[maxlength="250"]', 'Исправить реквизиты');
 await click(button('button', 'Подтвердить аннулирование'), 'confirm cancellation');
 await wait(async () => (await tripDocuments())[0].status === 'cancelled', 'cancelled waybill');
 await click(button('button', 'Сформировать ф.23а'), 'reissue trip waybill');
 await wait(async () => (await tripDocuments()).some((item) =>
  item.id !== original.id && item.replacesWaybillIds?.includes(original.id)
 ), 'replacement linked');
 console.log('Trip selection, isolation and waybill replacement verified');

 const replacement = (await tripDocuments()).find((item) => item.replacesWaybillIds?.includes(original.id));
 const tripHeaders = { 'x-postcode-trip': firstTrip, 'content-type': 'application/json' };
 const released = await fetch(base + '/api/waybills/' + replacement.id + '/cancel', {
  method: 'POST', headers: tripHeaders, body: JSON.stringify({ reason: 'Проверка вложенных ёмкостей' }),
 });
 if (!released.ok) throw Error('Unable to release container for nesting test');
 await navigate('/containers');
 await click(button('button', firstShipment.containerId), 'open inner container');
 await click(button('button', 'Открыть снова'), 'reopen inner container');
 await click(button('button', 'Изменить реквизиты'), 'select weighed category');
 await evaluate(`(() => {
  const category = document.querySelector('select[name="category"]');
  category.value = 'Простая';
  category.dispatchEvent(new Event('change', { bubbles: true }));
 })()`);
 await click(button('form button','Сохранить'), 'save weighed category');
 await click(button('button', 'Взвесить'), 'read demo scale');
 await click(button('button', 'Принять вес с весов'), 'accept scale reading');
 await click(button('button', 'Закрыть ёмкость'), 'close weighed container');
 await wait(async () => {
  const item = await (await fetch(base + '/api/containers/' + firstShipment.containerId)).json();
  return item.status === 'closed' && item.measuredWeightGrams > 0 && item.weightEvidence?.source === 'scale';
 }, 'measurement saved');
 await click(button('button', 'Создать внешний контейнер'), 'create outer container');
 await click(button('form button', 'Вложить ёмкость'), 'nest weighed container');
 await wait(() => evaluate('document.body.textContent.includes("Вложенные ёмкости · 1")'), 'nested container visible');
 await click(button('button', 'Закрыть ёмкость'), 'close outer container');
 await navigate('/finish');
 await click(button('button', 'Сформировать ф.23а'), 'form waybill for nested container');
 await wait(async () => (await tripDocuments()).some((item) => item.status === 'formed' &&
  item.totalContainers === 1 && item.totalShipments === 1 && !item.containerIds.includes(firstShipment.containerId)
 ), 'waybill counts the outer container only');
 console.log('Demo weighing, container nesting and document quantities verified');
}finally{
 ws?.close();edge?.kill();child.kill();http.close();
 http.closeAllConnections(); await delay(750);
 if(dir.startsWith(tempRoot+sep+'postcode-browser-'))try{rmSync(dir,{recursive:true,force:true,maxRetries:2});}catch{}
}
