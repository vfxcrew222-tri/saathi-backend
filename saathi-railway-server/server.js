const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
const app = express();
app.use(cors()); app.use(express.json({limit:'20kb'}));
const server = http.createServer(app);
const io = new Server(server, {cors:{origin:'*'}});
const providers = new Map(); const jobs = new Map();
const RADII=[10,25,50,100,250,500,1000,2000];
function validCoords(lat,lng){return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;}
function distance(a,b){const R=6371000, r=x=>x*Math.PI/180, dLat=r(b.lat-a.lat),dLng=r(b.lng-a.lng);const z=Math.sin(dLat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLng/2)**2;return 2*R*Math.atan2(Math.sqrt(z),Math.sqrt(1-z));}
function broadcast(job){io.to(`job:${job.id}`).emit('job:update',job);}
function parseTime(value){
  if(typeof value!=='string' || !value.trim()) return null;
  const ms=Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function requestReschedule(job, scheduledAt, reason='Itinerary arrival time changed'){
  const normalized=parseTime(scheduledAt);
  if(!normalized) return {ok:false,error:'scheduledAt must be a valid ISO date/time'};
  if(['completed','cancelled'].includes(job.status)) return {ok:false,error:'Completed or cancelled jobs cannot be rescheduled'};
  job.updatedAt=Date.now();
  job.rescheduleReason=String(reason||'Itinerary arrival time changed').slice(0,300);
  if(job.status==='accepted' || job.status==='arrived' || job.status==='in_progress'){
    job.proposedScheduledAt=normalized;
    job.status='reschedule_required';
    broadcast(job);
    if(job.providerId) io.to(job.providerId).emit('job:reschedule_offer',{
      jobId:job.id, currentScheduledAt:job.scheduledAt||null,
      proposedScheduledAt:normalized, reason:job.rescheduleReason
    });
    return {ok:true,status:job.status,requiresProviderConfirmation:true};
  }
  job.scheduledAt=normalized;
  job.proposedScheduledAt=null;
  broadcast(job);
  if(job.status==='searching') match(job);
  return {ok:true,status:job.status,requiresProviderConfirmation:false};
}
function match(job){if(job.status!=='searching')return;const radius=RADII[job.radiusIndex];const eligible=[...providers.entries()].filter(([id,p])=>p.available&&p.lat!==null&&distance(job,p)<=radius&&!job.declined.includes(id)).sort((a,b)=>distance(job,a[1])-distance(job,b[1]));for(const [id,p] of eligible){io.to(id).emit('job:offer',{jobId:job.id,category:job.category,description:job.description,from:job.from,to:job.to,bags:job.bags,distanceMeters:Math.round(distance(job,p))});}io.to(`job:${job.id}`).emit('search:radius',{jobId:job.id,radiusMeters:radius,eligibleCount:eligible.length});}
app.get('/',(_,res)=>res.json({service:'SAATHI pilot backend',status:'online',version:'0.1.0'}));
app.get('/health',(_,res)=>res.json({ok:true}));
io.on('connection',socket=>{
 socket.on('provider:availability',(data={},ack=()=>{})=>{const lat=Number(data.lat),lng=Number(data.lng);if(!validCoords(lat,lng))return ack({ok:false,error:'Valid GPS coordinates required'});providers.set(socket.id,{available:!!data.available,lat,lng,updatedAt:Date.now()});ack({ok:true});for(const job of jobs.values())if(job.status==='searching')match(job);});
 socket.on('provider:location',(data={},ack=()=>{})=>{const p=providers.get(socket.id),lat=Number(data.lat),lng=Number(data.lng);if(!p||!validCoords(lat,lng))return ack({ok:false,error:'Invalid location or not registered'});Object.assign(p,{lat,lng,updatedAt:Date.now()});ack({ok:true});});
 socket.on('job:create',(data={},ack=()=>{})=>{const lat=Number(data.lat),lng=Number(data.lng);if(!validCoords(lat,lng)||!String(data.description||'').trim())return ack({ok:false,error:'Description and valid GPS required'});const id=crypto.randomUUID();const job={id,lat,lng,category:String(data.category||'Other Help').slice(0,80),description:String(data.description).slice(0,500),from:String(data.from||'').slice(0,200),to:String(data.to||'').slice(0,200),bags:String(data.bags||'').slice(0,20),status:'searching',radiusIndex:0,declined:[],providerId:null,
scheduledAt:parseTime(data.scheduledAt),proposedScheduledAt:null,rescheduleReason:null,updatedAt:Date.now(),createdAt:Date.now()};jobs.set(id,job);socket.join(`job:${id}`);ack({ok:true,jobId:id});match(job);});
 socket.on('job:watch',(data={},ack=()=>{})=>{const job=jobs.get(data.jobId);if(!job)return ack({ok:false,error:'Job not found'});socket.join(`job:${job.id}`);ack({ok:true,job});});
 socket.on('job:expand',(data={},ack=()=>{})=>{const job=jobs.get(data.jobId);if(!job||job.status!=='searching')return ack({ok:false,error:'Job not searching'});job.radiusIndex=Math.min(job.radiusIndex+1,RADII.length-1);match(job);ack({ok:true,radiusMeters:RADII[job.radiusIndex]});});
 socket.on('job:respond',(data={},ack=()=>{})=>{const job=jobs.get(data.jobId),p=providers.get(socket.id);if(!job||!p?.available||job.status!=='searching')return ack({ok:false,error:'Job unavailable'});if(distance(job,p)>RADII[job.radiusIndex])return ack({ok:false,error:'Outside current search radius'});if(data.accept===true){job.status='accepted';job.providerId=socket.id;p.available=false;broadcast(job);io.to(socket.id).emit('job:assigned',job);ack({ok:true});}else{job.declined.push(socket.id);ack({ok:true});}});
 socket.on('job:reschedule',(data={},ack=()=>{})=>{
   const job=jobs.get(data.jobId);
   if(!job)return ack({ok:false,error:'Job not found'});
   const result=requestReschedule(job,data.scheduledAt,data.reason);
   ack(result);
 });
 socket.on('itinerary:reschedule',(data={},ack=()=>{})=>{
   if(!Array.isArray(data.updates)||data.updates.length<1||data.updates.length>50)
     return ack({ok:false,error:'updates must contain 1 to 50 {jobId,scheduledAt} items'});
   const results=data.updates.map(item=>{
     const job=jobs.get(item.jobId);
     if(!job)return {jobId:item.jobId,ok:false,error:'Job not found'};
     return {jobId:job.id,...requestReschedule(job,item.scheduledAt,data.reason||'Following itinerary stops shifted')};
   });
   ack({ok:true,results});
 });
 socket.on('job:reschedule:respond',(data={},ack=()=>{})=>{
   const job=jobs.get(data.jobId);
   if(!job||job.providerId!==socket.id||job.status!=='reschedule_required'||!job.proposedScheduledAt)
     return ack({ok:false,error:'No reschedule confirmation is pending for this Saathi'});
   if(data.accept===true){
     job.scheduledAt=job.proposedScheduledAt;job.proposedScheduledAt=null;
     job.status='accepted';job.updatedAt=Date.now();
     broadcast(job);io.to(socket.id).emit('job:assigned',job);ack({ok:true,status:job.status,scheduledAt:job.scheduledAt});
   }else{
     const previousProvider=job.providerId;
     const revisedTime=job.proposedScheduledAt;
     job.declined.push(previousProvider);job.providerId=null;job.proposedScheduledAt=null;
     job.scheduledAt=revisedTime||job.scheduledAt;
     job.status='searching';job.radiusIndex=0;job.updatedAt=Date.now();
     const previous=providers.get(previousProvider);if(previous)previous.available=true;
     broadcast(job);match(job);ack({ok:true,status:job.status,searchingAgain:true});
   }
 });
 socket.on('job:status',(data={},ack=()=>{})=>{const job=jobs.get(data.jobId);if(!job||job.providerId!==socket.id||!['arrived','in_progress','completed'].includes(data.status))return ack({ok:false,error:'Not allowed'});job.status=data.status;broadcast(job);ack({ok:true});});
 socket.on('disconnect',()=>providers.delete(socket.id));
});
// Pilot-only automatic radius expansion; state is in RAM and resets on redeploy.
setInterval(()=>{const now=Date.now();for(const [id,j] of jobs){if(j.status==='searching'&&j.radiusIndex<RADII.length-1&&now-j.createdAt>(j.radiusIndex+1)*12000){j.radiusIndex++;match(j);}if(now-j.createdAt>3600000)jobs.delete(id);}},3000).unref();
const port=process.env.PORT||3000;server.listen(port,'0.0.0.0',()=>console.log(`SAATHI server on ${port}`));
