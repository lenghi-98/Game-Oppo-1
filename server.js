'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
let rooms = {};
let sockets = new Set();

try { if (fs.existsSync(DATA_FILE)) rooms = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { console.error('Could not load data:', e.message); }
function save() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(rooms, null, 2)); } catch(e) { console.error('Save failed:', e.message); } }
function code() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function uid() { return crypto.randomBytes(8).toString('hex'); }
function clean(s, n=50) { return String(s || '').trim().slice(0,n); }
function json(res, status, data) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
function publicRoom(room) {
  return {
    code: room.code, title: room.title, phase: room.phase, teams: room.teams,
    players: room.players.map(p => ({id:p.id,name:p.name,teamId:p.teamId,online:p.online,isCaptain:p.isCaptain,score:p.score})),
    pendingPlayers: (room.pendingPlayers||[]).map(p => ({id:p.id,name:p.name,teamId:p.teamId,online:p.online})),
    questionIndex: room.questionIndex, questionTotal: room.questions.length, questions: room.questions.map(q=>({id:q.id,text:q.text,topic:q.topic})),
    currentQuestion: room.currentQuestion ? {id:room.currentQuestion.id,text:room.currentQuestion.text,options:room.phase==='answerReveal'?room.currentQuestion.options:undefined,correctIndex:room.phase==='answerReveal'?room.currentQuestion.correctIndex:undefined,explanation:room.phase==='answerReveal'?room.currentQuestion.explanation:undefined,topic:room.currentQuestion.topic} : null,
    tap: room.tap ? {endsAt:room.tap.endsAt,duration:room.tap.duration,counts:room.tap.counts,playerCounts:room.tap.playerCounts,eligibleTeamIds:room.tap.eligibleTeamIds,mode:room.tap.mode} : null,
    winnerTeamId:room.winnerTeamId, teamScores:room.teamScores, lastJudgement:room.lastJudgement,
    trainerConnected: room.trainerConnected
  };
}
function send(ws, obj) { if (ws && ws.readyState === 1) { try { ws.writeFrame(JSON.stringify(obj)); } catch(e) {} } }
function broadcast(roomCode, obj) { for (const ws of sockets) if (ws.roomCode === roomCode && ws.readyState === 1) send(ws,obj); }
function sync(room) { for (const ws of sockets) if (ws.roomCode === room.code && ws.readyState === 1) { const state=publicRoom(room); if (ws.role==='trainer' && room.currentQuestion) state.currentQuestion={...state.currentQuestion,options:room.currentQuestion.options,correctIndex:room.currentQuestion.correctIndex,explanation:room.currentQuestion.explanation}; send(ws,{type:'state',state}); } }
function teamById(room,id) { return room.teams.find(t=>t.id===id); }
function playerById(room,id) { return room.players.find(p=>p.id===id); }
function pendingPlayerById(room,id) { return (room.pendingPlayers||[]).find(p=>p.id===id); }
function isActivePhase(phase) { return ['tap','tiebreak','sudden100','winner','question','answerReveal'].includes(phase); }
function teamCount(room, teamId) { return room.players.filter(p=>p.teamId===teamId).length; }
function teamTapAverage(room, teamId) { const n=teamCount(room,teamId); return n ? (room.tap.counts[teamId]||0)/n : 0; }
function rankedTeams(room) { return room.teams.map(t=>({id:t.id,name:t.name,score:room.teamScores[t.id]||0,average:0,members:teamCount(room,t.id)})).sort((a,b)=>b.score-a.score || a.name.localeCompare(b.name)); }
function stateForDisplay(room) { return publicRoom(room); }
function nextTap(room, duration, mode='normal', eligibleTeamIds=null) {
  room.phase = mode==='normal'?'tap':mode==='sudden100'?'sudden100':'tiebreak';
  room.tap = {duration,endsAt:Date.now()+duration*1000,counts:Object.fromEntries(room.teams.map(t=>[t.id,0])),playerCounts:Object.fromEntries(room.players.map(p=>[p.id,0])),eligibleTeamIds:eligibleTeamIds || room.teams.map(t=>t.id),mode};
  room.winnerTeamId = null;
  sync(room);
  if(mode!=='sudden100') setTimeout(()=>finishTap(room.code, room.tap && room.tap.endsAt), duration*1000+80);
}
function finishTap(roomCode, expectedEnd) {
  const room=rooms[roomCode]; if(!room || !room.tap || room.tap.endsAt!==expectedEnd) return;
  const ids=room.tap.eligibleTeamIds;
  if(room.tap.mode==='sudden100') {
    const winner=ids.find(id=>(room.tap.counts[id]||0)>=100);
    if(winner) return chooseWinner(room,winner);
    // The sudden-death target is race-based. In the unlikely case of a timer-based end, continue.
    return nextTap(room,5,'sudden100',ids);
  }
  const values=ids.map(id=>({id,avg:teamTapAverage(room,id)}));
  const max=Math.max(...values.map(v=>v.avg));
  const leaders=values.filter(v=>Math.abs(v.avg-max)<1e-9).map(v=>v.id);
  if(leaders.length===1) return chooseWinner(room,leaders[0]);
  if(room.tap.mode==='normal') return nextTap(room,5,'tiebreak',leaders);
  return nextTap(room,5,'sudden100',leaders);
}
function chooseWinner(room, teamId) {
  room.phase='winner'; room.winnerTeamId=teamId; room.tap=null; sync(room); save();
}
function beginQuestion(room) {
  if(!room.questions.length) return {error:'Hãy thêm ít nhất một câu hỏi trước khi bắt đầu.'};
  if(room.pendingPlayers?.length) { room.players.push(...room.pendingPlayers); room.pendingPlayers=[]; }
  room.questionIndex = Math.min(room.questionIndex+1, room.questions.length);
  room.currentQuestion = room.questions[(room.questionIndex-1)%room.questions.length];
  room.phase='question'; room.tap=null; room.winnerTeamId=null; room.lastJudgement=null; sync(room); save(); return {};
}
function handleMessage(ws, msg) {
  let room=rooms[ws.roomCode]; if(!room) return send(ws,{type:'error',message:'Phòng không tồn tại.'});
  const fail=(message)=>send(ws,{type:'error',message});
  if(msg.type==='joinPlayer') {
    if(ws.role!=='join') return;
    const name=clean(msg.name,32); if(!name) return fail('Vui lòng nhập tên hiển thị.');
    if(room.phase==='finished') return fail('Game đã kết thúc, không thể tham gia thêm.');
    if(!teamById(room,msg.teamId)) return fail('Đội không hợp lệ.');
    let p=playerById(room,ws.playerId)||pendingPlayerById(room,ws.playerId);
    if(p && p.name!==name) p.name=name;
    if(!p) { const hasCaptain=room.players.some(x=>x.teamId===msg.teamId&&x.isCaptain)||(room.pendingPlayers||[]).some(x=>x.teamId===msg.teamId&&x.isCaptain); p={id:uid(),name,teamId:msg.teamId,score:0,online:true,isCaptain:!hasCaptain}; if(isActivePhase(room.phase)) room.pendingPlayers.push(p); else room.players.push(p); ws.playerId=p.id; }
    p.online=true; ws.playerId=p.id; send(ws,{type:'joined',playerId:p.id,pending:!!pendingPlayerById(room,p.id)}); sync(room); save(); return;
  }
  if(msg.type==='reconnectPlayer') {
    const p=playerById(room,msg.playerId)||pendingPlayerById(room,msg.playerId); if(!p) return fail('Không tìm thấy thông tin người chơi.');
    p.online=true; ws.playerId=p.id; send(ws,{type:'joined',playerId:p.id}); sync(room); return;
  }
  if(msg.type==='tap') {
    const p=playerById(room,ws.playerId); if(!p || !p.online) return;
    if(!room.tap || !['tap','tiebreak','sudden100'].includes(room.phase)) return;
    if(Date.now()>room.tap.endsAt && room.tap.mode!=='sudden100') return;
    if(!room.tap.eligibleTeamIds.includes(p.teamId)) return;
    room.tap.counts[p.teamId]=(room.tap.counts[p.teamId]||0)+1;
    room.tap.playerCounts[p.id]=(room.tap.playerCounts[p.id]||0)+1;
    send(ws,{type:'tapAck',count:room.tap.playerCounts[p.id]});
    if(room.tap.mode==='sudden100' && room.tap.counts[p.teamId]>=100) chooseWinner(room,p.teamId);
    else for(const client of sockets) if(client.roomCode===room.code && (client.role==='trainer'||client.role==='display')) send(client,{type:'tapProgress',counts:room.tap.counts,phase:room.phase});
    return;
  }
  if(ws.role!=='trainer') return;
  if(msg.type==='setCaptain') {
    const p=playerById(room,msg.playerId); if(!p) return fail('Không tìm thấy PG.');
    room.players.forEach(x=>{if(x.teamId===p.teamId)x.isCaptain=false;}); p.isCaptain=true; sync(room); save(); return;
  }
  if(msg.type==='addQuestion') {
    const q={id:uid(),topic:clean(msg.topic,60),text:clean(msg.text,500),options:(msg.options||[]).slice(0,4).map(x=>clean(x,240)),correctIndex:Number(msg.correctIndex),explanation:clean(msg.explanation,1000)};
    if(!q.text || q.options.length!==4 || q.options.some(x=>!x) || ![0,1,2,3].includes(q.correctIndex)) return fail('Câu hỏi cần có nội dung, đủ 4 phương án và đáp án đúng.');
    room.questions.push(q); sync(room); save(); return;
  }
  if(msg.type==='deleteQuestion') { room.questions=room.questions.filter(q=>q.id!==msg.questionId); room.questionIndex=Math.min(room.questionIndex,room.questions.length); sync(room); save(); return; }
  if(msg.type==='startTap') {
    if(!['ready','leaderboard'].includes(room.phase)) return fail('Chưa thể bắt đầu lượt tap ở trạng thái hiện tại.');
    if(!room.players.length) return fail('Chưa có PG tham gia phòng.');
    if(room.teams.filter(t=>teamCount(room,t.id)>0).length<2) return fail('Cần ít nhất 2 đội có PG đăng ký để bắt đầu.');
    if(room.phase==='leaderboard' || !room.currentQuestion) { if(room.questionIndex>=room.questions.length) return fail('Đã hết câu hỏi trong bộ hiện tại.'); const r=beginQuestion(room); if(r.error)return fail(r.error); }
    nextTap(room,10,'normal',room.teams.filter(t=>teamCount(room,t.id)>0).map(t=>t.id)); return;
  }
  if(msg.type==='showQuestion') { if(room.phase!=='winner') return fail('Chưa xác định đội thắng.'); room.phase='question'; sync(room); return; }
  if(msg.type==='revealAnswer') { if(room.phase!=='question') return fail('Không thể công bố đáp án lúc này.'); room.phase='answerReveal'; sync(room); return; }
  if(msg.type==='judge') {
    if(room.phase!=='answerReveal') return fail('Hãy công bố đáp án trước khi chấm.');
    const correct=!!msg.correct; const captain=room.players.find(p=>p.teamId===room.winnerTeamId && p.isCaptain) || room.players.find(p=>p.teamId===room.winnerTeamId);
    if(correct) { room.teamScores[room.winnerTeamId]=(room.teamScores[room.winnerTeamId]||0)+100; if(captain) captain.score+=100; }
    room.lastJudgement={correct,teamId:room.winnerTeamId,captainId:captain?captain.id:null}; room.phase='leaderboard'; sync(room); save(); return;
  }
  if(msg.type==='nextQuestion') { if(room.phase!=='leaderboard') return fail('Chưa hoàn tất lượt hiện tại.'); if(room.questionIndex>=room.questions.length) { room.phase='finished'; sync(room); save(); return; } beginQuestion(room); return; }
  if(msg.type==='finish') { room.phase='finished'; room.tap=null; sync(room); save(); return; }
  if(msg.type==='reset') { room.phase='ready'; room.questionIndex=0; room.currentQuestion=null; room.winnerTeamId=null; room.tap=null; room.teamScores=Object.fromEntries(room.teams.map(t=>[t.id,0])); room.players.forEach(p=>p.score=0); room.lastJudgement=null; sync(room); save(); return; }
  if(msg.type==='renameTeam') { const t=teamById(room,msg.teamId); if(t){t.name=clean(msg.name,24)||t.name;sync(room);save();} return; }
  if(msg.type==='removePlayer') { room.players=room.players.filter(p=>p.id!==msg.playerId); sync(room); save(); return; }
}
function createRoom(body) {
  const teams=(Array.isArray(body.teams)?body.teams:[]).map((t,i)=>({id:uid(),name:clean(t.name,24)||`TEAM ${String(i+1).padStart(2,'0')}`}));
  if(teams.length<2) return {error:'Cần tạo ít nhất 2 đội.'};
  let c; do{c=code();}while(rooms[c]);
  const room={code:c,title:clean(body.title,60)||'OPPO CAMERA ARENA',teams,players:[],pendingPlayers:[],questions:[],phase:'ready',questionIndex:0,currentQuestion:null,tap:null,winnerTeamId:null,teamScores:Object.fromEntries(teams.map(t=>[t.id,0])),lastJudgement:null,trainerToken:uid(),createdAt:Date.now(),trainerConnected:false};
  rooms[c]=room; save(); return {room,trainerToken:room.trainerToken};
}
const server=http.createServer((req,res)=>{
  const parsed=url.parse(req.url,true);
  if(req.method==='POST' && parsed.pathname==='/api/rooms') {
    let raw=''; req.on('data',c=>{raw+=c; if(raw.length>1e6) req.destroy();}); req.on('end',()=>{try{const result=createRoom(JSON.parse(raw||'{}')); if(result.error)return json(res,400,{error:result.error}); json(res,201,{code:result.room.code,trainerToken:result.trainerToken,joinUrl:`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host}/?view=join&room=${result.room.code}`,displayUrl:`/?view=display&room=${result.room.code}`,state:publicRoom(result.room)});}catch(e){json(res,400,{error:'Dữ liệu tạo phòng không hợp lệ.'});}}); return;
  }
  if(req.method==='GET' && parsed.pathname==='/api/rooms') { const room=rooms[String(parsed.query.code||'').toUpperCase()]; return room?json(res,200,{state:publicRoom(room)}):json(res,404,{error:'Không tìm thấy phòng.'}); }
  let pathname=decodeURIComponent(parsed.pathname||'/'); if(pathname==='/') pathname='/index.html';
  const file=path.normalize(path.join(PUBLIC,pathname)); if(!file.startsWith(PUBLIC)){res.writeHead(403);return res.end('Forbidden');}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);});
});
server.on('upgrade',(req,socket)=>{
  const parsed=url.parse(req.url,true); if(parsed.pathname!=='/ws'){socket.destroy();return;}
  const key=req.headers['sec-websocket-key']; if(!key){socket.destroy();return;}
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  const ws={socket,readyState:1,buffer:Buffer.alloc(0),roomCode:null,role:null,playerId:null,writeFrame(data){const payload=Buffer.from(data);let header;if(payload.length<126){header=Buffer.from([0x81,payload.length]);}else if(payload.length<65536){header=Buffer.alloc(4);header[0]=0x81;header[1]=126;header.writeUInt16BE(payload.length,2);}else{header=Buffer.alloc(10);header[0]=0x81;header[1]=127;header.writeBigUInt64BE(BigInt(payload.length),2);}socket.write(Buffer.concat([header,payload]));}};
  sockets.add(ws);
  socket.on('data',chunk=>{ws.buffer=Buffer.concat([ws.buffer,chunk]); while(ws.buffer.length>=2){const b0=ws.buffer[0],b1=ws.buffer[1];let len=b1&127,off=2;if(len===126){if(ws.buffer.length<4)return;len=ws.buffer.readUInt16BE(2);off=4;}else if(len===127){if(ws.buffer.length<10)return;len=Number(ws.buffer.readBigUInt64BE(2));off=10;}const masked=!!(b1&128);if(masked)off+=4;if(ws.buffer.length<off+len)return;let payload=ws.buffer.subarray(off,off+len);if(masked){const mask=ws.buffer.subarray(off-4,off);payload=Buffer.from(payload);for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];}ws.buffer=ws.buffer.subarray(off+len);if((b0&15)===8){socket.end();return;}if((b0&15)===9){socket.write(Buffer.from([0x8a,0]));continue;}if((b0&15)!==1)continue;try{const msg=JSON.parse(payload.toString());if(msg.type==='hello'){const room=rooms[String(msg.room||'').toUpperCase()];if(!room){send(ws,{type:'error',message:'Phòng không tồn tại.'});continue;}ws.roomCode=room.code;ws.role=msg.role;if(msg.role==='trainer'){if(msg.token!==room.trainerToken){send(ws,{type:'error',message:'Mã điều khiển không hợp lệ.'});continue;}room.trainerConnected=true;}else if(msg.role==='display'){}else if(msg.role==='join'){if(msg.playerId)ws.playerId=msg.playerId;}const initialState=publicRoom(room);if(ws.role==='trainer'&&room.currentQuestion)initialState.currentQuestion={...initialState.currentQuestion,options:room.currentQuestion.options,correctIndex:room.currentQuestion.correctIndex,explanation:room.currentQuestion.explanation};send(ws,{type:'state',state:initialState});if(ws.role==='join'&&ws.playerId){const p=playerById(room,ws.playerId)||pendingPlayerById(room,ws.playerId);if(p){p.online=true;sync(room);}}}else if(ws.roomCode){handleMessage(ws,msg);}}catch(e){send(ws,{type:'error',message:'Không đọc được dữ liệu gửi lên.'});}}});
  socket.on('close',()=>{sockets.delete(ws);if(ws.roomCode){const room=rooms[ws.roomCode];if(room){if(ws.role==='trainer')room.trainerConnected=false;if(ws.playerId){const p=playerById(room,ws.playerId)||pendingPlayerById(room,ws.playerId);if(p)p.online=false;}sync(room);save();}}});socket.on('error',()=>{sockets.delete(ws);});
});
server.listen(PORT,HOST,()=>console.log(`OPPO Camera Arena running at http://localhost:${PORT}`));
