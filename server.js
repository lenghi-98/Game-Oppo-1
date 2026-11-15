const express=require('express'), http=require('http'), {Server}=require('socket.io');
const fs=require('fs'), path=require('path'), crypto=require('crypto');
const app=express(), server=http.createServer(app), io=new Server(server);
const PORT=process.env.PORT||3000, DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'data');
fs.mkdirSync(DATA_DIR,{recursive:true}); const DB=path.join(DATA_DIR,'rooms.json');
let rooms={}; try{rooms=JSON.parse(fs.readFileSync(DB,'utf8'))}catch{}
const save=()=>fs.writeFileSync(DB,JSON.stringify(rooms,null,2));
const code=()=>String(Math.floor(100000+Math.random()*900000));
const pub=path.join(__dirname,'public'); app.use(express.static(pub));
app.get('/health',(q,s)=>s.json({ok:true}));
app.get(['/trainer','/display','/join','/play'],(q,s)=>s.sendFile(path.join(pub,'index.html')));
function clean(r){return {...r,trainerSocket:undefined}}
function emit(room){io.to(room.code).emit('state',clean(room));save()}
io.on('connection',socket=>{
 socket.on('create-room',({trainerName='Trainer'}={})=>{let c=code();while(rooms[c])c=code();rooms[c]={code:c,trainerName,teams:[],players:[],phase:'lobby',round:0,question:null,leaderboard:{},tieTeams:[],taps:{},deadline:null};socket.join(c);rooms[c].trainerSocket=socket.id;socket.emit('created',{code:c});emit(rooms[c]);});
 socket.on('watch-room',({code:c})=>{let r=rooms[c];if(!r)return socket.emit('error-msg','Không tìm thấy phòng');socket.join(c);socket.emit('state',clean(r));});
 socket.on('get-room',({code:c})=>{let r=rooms[c];socket.emit('room-info',r?{teams:r.teams,phase:r.phase}:null)});
 socket.on('add-team',({code:c,name})=>{let r=rooms[c];if(!r)return;if(name&& !r.teams.includes(name))r.teams.push(name);emit(r)});
 socket.on('join-room',({code:c,name,team,session})=>{let r=rooms[c];if(!r)return socket.emit('join-error','Không tìm thấy phòng');let p=r.players.find(x=>x.session===session);if(!p){p={id:crypto.randomUUID(),session:session||crypto.randomUUID(),name,team,score:0};r.players.push(p)}else{p.name=name;p.team=team}socket.join(c);socket.emit('joined',{session:p.session});emit(r)});
 socket.on('start-round',({code:c})=>{let r=rooms[c];if(!r)return;r.phase='tapping';r.round++;r.taps={};r.tieTeams=[];r.deadline=Date.now()+10000;emit(r);setTimeout(()=>resolve(r),10000)});
 socket.on('tap',({code:c,session})=>{let r=rooms[c];if(!r||!['tapping','tie','race100'].includes(r.phase))return;let p=r.players.find(x=>x.session===session);if(!p)return;r.taps[p.id]=(r.taps[p.id]||0)+1;if(r.phase==='race100'&&r.tieTeams.includes(p.team)){let total=r.players.filter(x=>x.team===p.team).reduce((a,x)=>a+(r.taps[x.id]||0),0);if(total>=100){r.winner=p.team;r.phase='question';emit(r)}}});
 function resolve(r){if(!r||r.phase!=='tapping')return;let sums={};r.teams.forEach(t=>sums[t]=0);r.players.forEach(p=>sums[p.team]=(sums[p.team]||0)+(r.taps[p.id]||0));let avgs=Object.keys(sums).map(t=>[t,sums[t]/Math.max(1,r.players.filter(p=>p.team===t).length)]).sort((a,b)=>b[1]-a[1]);let top=avgs[0]?.[1]??0;r.tieTeams=avgs.filter(x=>x[1]===top).map(x=>x[0]);if(r.tieTeams.length===1){r.winner=r.tieTeams[0];r.phase='question'}else{r.phase='tie';r.deadline=Date.now()+5000;emit(r);setTimeout(()=>resolveTie(r),5000)}emit(r)}
 function resolveTie(r){if(!r||r.phase!=='tie')return;let sums={};r.tieTeams.forEach(t=>sums[t]=0);r.players.filter(p=>r.tieTeams.includes(p.team)).forEach(p=>sums[p.team]+=(r.taps[p.id]||0));let a=Object.entries(sums).sort((x,y)=>y[1]-x[1]);if(a.length&&a[0][1]!==a[1]?.[1]){r.winner=a[0][0];r.phase='question'}else{r.phase='race100';r.taps={}}emit(r)}
 socket.on('set-question',({code:c,question})=>{let r=rooms[c];if(r){r.question=question;r.phase='question';emit(r)}});
 socket.on('reveal',({code:c})=>{let r=rooms[c];if(r){r.phase='revealed';emit(r)}});
 socket.on('mark-answer',({code:c,correct,leader})=>{let r=rooms[c];if(!r||r.phase!=='revealed')return;if(correct){r.leaderboard[r.winner]=(r.leaderboard[r.winner]||0)+100;let p=r.players.find(x=>x.name===leader&&x.team===r.winner);if(p)p.score+=100}r.phase='result';emit(r)});
 socket.on('next-question',({code:c})=>{let r=rooms[c];if(r){r.phase='lobby';r.question=null;r.winner=null;emit(r)}});
 socket.on('end-game',({code:c})=>{let r=rooms[c];if(r){r.phase='ended';emit(r)}});
});
server.listen(PORT,()=>console.log('OPPO Camera Arena listening on '+PORT));
