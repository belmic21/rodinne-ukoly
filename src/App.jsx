import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase, dbToTask, taskToDb, dbToUser } from "./supabase.js";

/* ═══════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════ */
const UNDO_MS = 5000;
const PRI = [{ id:"urgent",label:"Akutní",w:0 },{ id:"important",label:"Důležité",w:1 },{ id:"low",label:"Nedůležité",w:2 }];
const CATS = [
  {id:"home",label:"Domácnost",icon:"🏠"},{id:"garden",label:"Zahrada",icon:"🌿"},
  {id:"finance",label:"Finance",icon:"💰"},{id:"kids",label:"Děti",icon:"👶"},
  {id:"health",label:"Zdraví",icon:"❤️"},{id:"car",label:"Auto",icon:"🚗"},
  {id:"shopping",label:"Nákupy",icon:"🛒"},{id:"work",label:"Práce",icon:"💼"},
  {id:"other",label:"Ostatní",icon:"📌"},
];
const REC = [{v:0,l:"Jednorázový"},{v:1,l:"Každý den"},{v:3,l:"Každé 3 dny"},{v:7,l:"Každý týden"},{v:14,l:"Každých 14 dní"},{v:30,l:"Každý měsíc"},{v:90,l:"Čtvrtletí"}];
const MOS = ["Led","Úno","Bře","Dub","Kvě","Čvn","Čvc","Srp","Zář","Říj","Lis","Pro"];

/* ═══ Helpers ═══ */
const uid=()=>crypto.randomUUID();
const gp=id=>PRI.find(p=>p.id===id)||PRI[1];
const gc=id=>CATS.find(c=>c.id===id)||CATS[8];
const dn=t=>t.status==="done"||t.status==="cancelled";
function dd(s){if(!s)return Infinity;return Math.round((new Date(s)-new Date(new Date().toDateString()))/864e5)}
function fd(iso){if(!iso)return"";const d=dd(iso);if(d===0)return"Dnes";if(d===1)return"Zítra";if(d===-1)return"Včera";if(d<-1)return`${Math.abs(d)}d po`;if(d<=7)return`Za ${d}d`;return new Date(iso).toLocaleDateString("cs-CZ",{day:"numeric",month:"short"})}
function ff(iso){if(!iso)return"";return new Date(iso).toLocaleDateString("cs-CZ",{day:"numeric",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"})}
const forgot=t=>!dn(t)&&!t.dueDate&&(Date.now()-new Date(t.createdAt).getTime())/864e5>30;
function addD(n){const d=new Date();d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)}
function ssort(a,b){
  const ao=dd(a.dueDate)<0&&!dn(a),bo=dd(b.dueDate)<0&&!dn(b);if(ao!==bo)return ao?-1:1;
  const fa=forgot(a),fb=forgot(b);if(fa!==fb)return fa?-1:1;
  const pw=gp(a.priority).w-gp(b.priority).w;if(pw)return pw;
  const da=dd(a.dueDate),db=dd(b.dueDate);if(da!==db)return da-db;
  return new Date(b.createdAt)-new Date(a.createdAt);
}
function noti(t,b){if("Notification"in window&&Notification.permission==="granted")try{new Notification(t,{body:b,icon:"/icon-192.png"})}catch(e){}}
function processRec(tasks){
  const now=new Date(),cm=now.getMonth()+1;const upd=[];
  const nt=tasks.map(t=>{
    if(t.recDays>0&&t.status==="done"&&t.completedAt){
      const nx=new Date(t.completedAt);nx.setDate(nx.getDate()+t.recDays);
      if(now>=nx&&(!t.activeMo?.length||t.activeMo.includes(cm))){
        const u={...t,status:"active",doneBy:[],completedAt:null,completedByUser:null,dueDate:nx.toISOString().slice(0,10),seenBy:[t.createdBy],checklist:t.checklist?.map(ci=>({...ci,done:false,doneBy:null,doneAt:null}))||[]};
        upd.push(u);return u;
      }}return t;});
  return{tasks:nt,updates:upd};
}
function searchMatch(t,q){
  if(!q)return true;const l=q.toLowerCase();
  return t.title?.toLowerCase().includes(l)||t.note?.toLowerCase().includes(l)||t.checklist?.some(c=>c.text?.toLowerCase().includes(l));
}

/* ═══ Theme ═══ */
const TH={
  dark:{bg:"#0c1017",card:"#131a24",cb:"#1a2233",hdr:"rgba(12,16,23,0.92)",tx:"#dbe4ed",ts:"#506880",td:"#2a3a50",tm:"#3a5060",ib:"#080c12",ibr:"#1a2438",ac:"#3b82f6",acs:"#3b82f612",acb:"#3b82f625",gn:"#22c55e",rd:"#ef4444",yl:"#f59e0b",pp:"#a855f7",pu:"#ef4444",pi:"#f59e0b",pl:"#64748b",bb:"#1e2e40",sb:"#1e293b",ub:"#0d1f1a",ubr:"#134e3a"},
  light:{bg:"#f5f7fa",card:"#ffffff",cb:"#e2e8f0",hdr:"rgba(245,247,250,0.92)",tx:"#1e293b",ts:"#64748b",td:"#cbd5e1",tm:"#94a3b8",ib:"#f1f5f9",ibr:"#e2e8f0",ac:"#2563eb",acs:"#2563eb10",acb:"#2563eb20",gn:"#16a34a",rd:"#dc2626",yl:"#d97706",pp:"#7c3aed",pu:"#dc2626",pi:"#d97706",pl:"#94a3b8",bb:"#e2e8f0",sb:"#ffffff",ub:"#f0fdf4",ubr:"#86efac"},
};
const F="'DM Sans',system-ui,sans-serif";
const CSS=`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,700&display=swap');
@keyframes glow{0%,100%{box-shadow:0 0 0 0 rgba(52,211,153,0.3)}50%{box-shadow:0 0 0 7px rgba(52,211,153,0)}}
@keyframes sUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes fIn{from{opacity:0}to{opacity:1}}@keyframes snIn{from{transform:translateY(80px);opacity:0}to{transform:translateY(0);opacity:1}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}select{appearance:auto}body{margin:0;font-family:'DM Sans',system-ui,sans-serif}`;
const cS=t=>({background:t.card,border:`1px solid ${t.cb}`,borderRadius:"12px"});
const iS=t=>({background:t.ib,border:`1px solid ${t.ibr}`,borderRadius:"8px",color:t.tx,padding:"10px 12px",fontSize:"14px",fontFamily:F,outline:"none",width:"100%",boxSizing:"border-box"});
const bS=()=>({border:"none",borderRadius:"8px",fontFamily:F,fontWeight:600,cursor:"pointer"});

/* ═══ API ═══ */
const aLU=async()=>{const{data}=await supabase.from("users").select("*").order("created_at");return(data||[]).map(dbToUser)};
const aLT=async()=>{const{data}=await supabase.from("tasks").select("*").order("created_at",{ascending:false});return(data||[]).map(dbToTask)};
const aCU=async u=>supabase.from("users").insert({name:u.name,pin:u.pin,is_admin:u.admin});
const aDU=async n=>supabase.from("users").delete().eq("name",n);
const aCT=async t=>supabase.from("tasks").insert(taskToDb(t));
const aUT=async t=>supabase.from("tasks").update(taskToDb(t)).eq("id",t.id);
const aUTs=async ts=>{for(const t of ts)await aUT(t)};

/* ═══════════════════════════════════════════
   SMALL COMPONENTS
   ═══════════════════════════════════════════ */

function Checklist({items=[],onChange,user,th,onAutoComplete}){
  const[v,setV]=useState("");
  const add=()=>{if(!v.trim())return;onChange([...items,{id:uid(),text:v.trim(),done:false,doneBy:null,doneAt:null}]);setV("")};
  const toggle=id=>{
    const nx=items.map(i=>i.id===id?{...i,done:!i.done,doneBy:!i.done?user:null,doneAt:!i.done?new Date().toISOString():null}:i);
    onChange(nx);
    if(nx.length>0&&nx.every(i=>i.done)&&onAutoComplete)setTimeout(onAutoComplete,200);
  };
  return(<div style={{marginTop:"8px"}} onClick={e=>e.stopPropagation()}>
    <div style={{fontSize:"10px",color:th.tm,fontWeight:700,marginBottom:"5px",textTransform:"uppercase",letterSpacing:"0.3px"}}>Checklist ({items.filter(i=>i.done).length}/{items.length})</div>
    {items.map(it=>(<div key={it.id} style={{display:"flex",alignItems:"center",gap:"8px",padding:"6px 8px",borderRadius:"6px",background:it.done?`${th.gn}08`:th.ib,border:`1px solid ${it.done?th.gn+"15":th.ibr}`,marginBottom:"3px"}}>
      <button onClick={()=>toggle(it.id)} style={{width:"22px",height:"22px",minWidth:"22px",borderRadius:"5px",border:`2px solid ${it.done?th.gn:th.td}`,background:it.done?th.gn:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:"11px",fontWeight:800}}>{it.done&&"✓"}</button>
      <span style={{flex:1,fontSize:"13px",color:it.done?th.ts:th.tx,textDecoration:it.done?"line-through":"none",lineHeight:1.3}}>{it.text}{it.done&&it.doneBy&&<span style={{fontSize:"10px",color:th.tm,marginLeft:"6px"}}>— {it.doneBy}</span>}</span>
    </div>))}
    <div style={{display:"flex",gap:"5px",marginTop:"5px"}}>
      <input placeholder="Přidat položku..." value={v} onChange={e=>setV(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} style={{...iS(th),fontSize:"13px",padding:"8px 10px",flex:1}}/>
      <button onClick={add} style={{...bS(),padding:"8px 14px",background:th.ac,color:"#fff",fontSize:"14px"}}>+</button>
    </div>
  </div>);
}

function Images({images=[],onChange,th}){
  const r=useRef();
  const add=e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>1048576){alert("Max 1 MB");return}const rd=new FileReader();rd.onload=()=>onChange([...images,{id:uid(),data:rd.result}]);rd.readAsDataURL(f);e.target.value=""};
  return(<div style={{marginTop:"8px"}} onClick={e=>e.stopPropagation()}>
    {images.length>0&&<div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginBottom:"6px"}}>{images.map(img=>(<div key={img.id} style={{position:"relative",width:"56px",height:"56px",borderRadius:"6px",overflow:"hidden",border:`1px solid ${th.cb}`}}><img src={img.data} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/><button onClick={()=>onChange(images.filter(i=>i.id!==img.id))} style={{position:"absolute",top:"1px",right:"1px",background:"rgba(0,0,0,0.65)",border:"none",color:"#fff",borderRadius:"50%",width:"16px",height:"16px",fontSize:"10px",cursor:"pointer",lineHeight:"16px",textAlign:"center",padding:0}}>×</button></div>))}</div>}
    <input ref={r} type="file" accept="image/*" capture="environment" onChange={add} style={{display:"none"}}/>
    <button onClick={()=>r.current?.click()} style={{...bS(),background:th.ib,border:`1px solid ${th.ibr}`,color:th.ts,padding:"6px 12px",fontSize:"11px"}}>📷 Fotka</button>
  </div>);
}

function AB({l,a,th,sub,sx}){return<button onClick={a} style={{...bS(),padding:"6px 12px",fontSize:"12px",background:sub?"transparent":`${th.gn}15`,color:sub?th.ts:th.gn,border:`1px solid ${sub?th.cb:th.gn+"30"}`,...sx}}>{l}</button>}

/* ═══════════════════════════════════════════
   TASK DETAIL (inline edit panel)
   ═══════════════════════════════════════════ */
function TaskDetail({task:t,user,users,onUpdate,onStatus,th}){
  const others=users.filter(u=>u.name!==user.name);
  const canAct=t.assignTo==="both"||t.assignedTo?.includes(user.name)||t.createdBy===user.name;
  const isDn=dn(t);
  const up=(k,v)=>onUpdate(t.id,{[k]:v});
  const qd=[{l:"Dnes",v:addD(0)},{l:"Zítra",v:addD(1)},{l:"3d",v:addD(3)},{l:"Týden",v:addD(7)},{l:"14d",v:addD(14)},{l:"Měsíc",v:addD(30)}];
  const lb={fontSize:"10px",color:th.tm,fontWeight:700,marginBottom:"3px",textTransform:"uppercase",letterSpacing:"0.3px"};
  const autoC=()=>{if(canAct)onStatus(t.id,t.assignTo==="both"?"done_all":"done")};

  return(<div style={{marginTop:"10px",paddingLeft:"32px",animation:"fIn 0.12s"}} onClick={e=>e.stopPropagation()}>
    {/* Note - editable */}
    <textarea placeholder="Přidat poznámku..." value={t.note||""} onChange={e=>up("note",e.target.value||null)} rows={2} style={{...iS(th),fontSize:"13px",marginBottom:"8px",resize:"vertical",lineHeight:1.4}}/>

    {!isDn&&<>
      {/* Quick settings */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px",marginBottom:"8px"}}>
        <div><div style={lb}>Priorita</div><select value={t.priority} onChange={e=>up("priority",e.target.value)} style={{...iS(th),padding:"8px",fontSize:"12px"}}>{PRI.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
        <div><div style={lb}>Kategorie</div><select value={t.category||"other"} onChange={e=>up("category",e.target.value)} style={{...iS(th),padding:"8px",fontSize:"12px"}}>{CATS.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}</select></div>
        <div><div style={lb}>Pro koho</div><select value={t.assignTo==="person"?"person":t.assignTo} onChange={e=>{const v=e.target.value;if(v==="self"){up("assignedTo",[user.name]);up("assignTo","self")}else if(v==="both"){up("assignedTo",users.map(u=>u.name));up("assignTo","both")}else if(others[0]){up("assignedTo",[others[0].name]);up("assignTo","person")}}} style={{...iS(th),padding:"8px",fontSize:"12px"}}><option value="self">Pro mě</option>{others.map(o=><option key={o.name} value="person">Pro {o.name}</option>)}<option value="both">Pro všechny</option></select></div>
        <div><div style={lb}>Opakování</div><select value={t.recDays||0} onChange={e=>up("recDays",Number(e.target.value))} style={{...iS(th),padding:"8px",fontSize:"12px"}}>{REC.map(r=><option key={r.v} value={r.v}>{r.l}</option>)}</select></div>
      </div>

      {/* Due date */}
      <div style={{marginBottom:"8px"}}><div style={lb}>Termín {t.dueDate&&<span style={{fontWeight:400,textTransform:"none"}}>— {fd(t.dueDate)}</span>}</div>
        <div style={{display:"flex",gap:"3px",flexWrap:"wrap",marginBottom:"4px"}}>
          {qd.map(q=><button key={q.l} onClick={()=>up("dueDate",q.v)} style={{...bS(),padding:"4px 7px",fontSize:"10px",background:t.dueDate===q.v?th.acs:th.ib,color:t.dueDate===q.v?th.ac:th.ts,border:`1px solid ${t.dueDate===q.v?th.acb:th.ibr}`}}>{q.l}</button>)}
          {t.dueDate&&<button onClick={()=>up("dueDate",null)} style={{...bS(),padding:"4px 7px",fontSize:"10px",background:"transparent",color:th.rd,border:`1px solid ${th.rd}25`}}>✕</button>}
        </div>
        <input type="date" value={t.dueDate||""} onChange={e=>up("dueDate",e.target.value||null)} style={{...iS(th),fontSize:"12px",padding:"6px 10px"}}/>
      </div>

      {/* Season months */}
      {t.recDays>0&&<div style={{marginBottom:"8px"}}><div style={lb}>Aktivní měsíce</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:"3px"}}>{MOS.map((m,i)=><button key={i} onClick={()=>{const am=t.activeMo||[];up("activeMo",am.includes(i+1)?am.filter(x=>x!==i+1):[...am,i+1])}} style={{...bS(),padding:"3px 6px",fontSize:"9px",background:(t.activeMo||[]).includes(i+1)?th.acs:th.ib,color:(t.activeMo||[]).includes(i+1)?th.ac:th.tm,border:`1px solid ${(t.activeMo||[]).includes(i+1)?th.acb:th.ibr}`}}>{m}</button>)}</div>
      </div>}

      {/* Type toggle */}
      <button onClick={()=>up("type",t.type==="complex"?"simple":"complex")} style={{...bS(),padding:"5px 10px",fontSize:"10px",background:th.ib,color:th.ts,border:`1px solid ${th.ibr}`,marginBottom:"6px"}}>{t.type==="complex"?"☰ Komplexní → Jednoduchý":"✓ Přepnout na komplexní (checklist)"}</button>
    </>}

    {/* Checklist */}
    {(t.checklist?.length>0||t.type==="complex")&&<Checklist items={t.checklist||[]} user={user.name} th={th} onChange={cl=>up("checklist",cl)} onAutoComplete={autoC}/>}
    {(t.images?.length>0||!isDn)&&<Images images={t.images||[]} th={th} onChange={imgs=>up("images",imgs)}/>}

    {/* Meta */}
    <div style={{fontSize:"10px",color:th.td,marginTop:"8px",display:"flex",flexDirection:"column",gap:"1px"}}>
      <span>Vytvořeno: {ff(t.createdAt)} ({t.createdBy})</span>
      {t.completedAt&&<span>Dokončeno: {ff(t.completedAt)}{t.completedByUser?` (${t.completedByUser})`:""}</span>}
      {t.recDays>0&&<span>🔄 {REC.find(r=>r.v===t.recDays)?.l}{t.activeMo?.length>0&&t.activeMo.length<12?` (${t.activeMo.map(m=>MOS[m-1]).join(", ")})`:""}</span>}
    </div>

    {/* Actions */}
    {!isDn&&canAct&&<div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginTop:"8px"}}>
      {t.assignTo==="both"?(<>{!t.doneBy?.includes(user.name)&&<AB l="Moje hotovo ✓" a={()=>onStatus(t.id,"done_my")} th={th}/>}{t.createdBy===user.name&&<AB l="Všichni ✓" a={()=>onStatus(t.id,"done_all")} th={th}/>}</>):(<>{t.status!=="in_progress"&&<AB l="◐ Rozpracováno" a={()=>onStatus(t.id,"in_progress")} th={th} sub/>}<AB l="Splněno ✓" a={()=>onStatus(t.id,"done")} th={th}/></>)}
      <AB l="⊘ Nerealizováno" a={()=>onStatus(t.id,"cancelled")} th={th} sub/>
    </div>}
    {isDn&&<AB l="↩ Vrátit zpět" a={()=>onStatus(t.id,"reopen")} th={th} sub sx={{marginTop:"8px"}}/>}
  </div>);
}

/* ═══════════════════════════════════════════
   TASK CARD
   ═══════════════════════════════════════════ */
function TaskCard({task:t,user,users,onStatus,onSeen,onUpdate,th}){
  const[open,setOpen]=useState(false);
  const isNew=!t.seenBy?.includes(user.name)&&t.createdBy!==user.name;
  const wasSeen=!isNew;
  const overdue=dd(t.dueDate)<0&&!dn(t);
  const soon=!overdue&&dd(t.dueDate)>=0&&dd(t.dueDate)<=3&&!dn(t);
  const fg=forgot(t);const isDn=dn(t);
  const inPr=t.status==="in_progress"||(t.assignTo==="both"&&(t.doneBy?.length||0)>0&&t.status!=="done");
  const p=gp(t.priority);
  const canAct=t.assignTo==="both"||t.assignedTo?.includes(user.name)||t.createdBy===user.name;
  const pcs={urgent:th.pu,important:th.pi,low:th.pl};

  const handleOpen=()=>{const nx=!open;setOpen(nx);if(nx&&isNew)onSeen(t.id)};
  const quickComplete=e=>{e.stopPropagation();if(t.assignTo==="both")onStatus(t.id,"done_my");else onStatus(t.id,"done")};

  let aLabel="";if(t.assignTo==="both")aLabel="Všichni";else if(t.createdBy!==t.assignedTo?.[0])aLabel=`→ ${t.assignedTo?.[0]}`;
  let bc=pcs[p.id]+"40";if(overdue)bc=th.rd;else if(soon)bc=th.yl;else if(isNew)bc=th.gn;else if(fg)bc=th.pp;
  const clD=t.checklist?.filter(c=>c.done).length||0,clT=t.checklist?.length||0;
  let cardBg=wasSeen?th.card:th.ub,cardBc=wasSeen?th.cb:th.ubr;
  if(isDn){cardBg=th.card;cardBc=th.cb}

  return(<div onClick={handleOpen} style={{background:cardBg,border:`1px solid ${cardBc}`,borderRadius:"12px",borderLeft:`3px solid ${bc}`,padding:"11px 13px",opacity:isDn?0.35:1,cursor:"pointer",position:"relative",animation:isNew?"glow 2s ease 3,sUp 0.3s ease":"sUp 0.3s ease",transition:"all 0.2s",...(overdue&&!isDn?{background:`linear-gradient(135deg,${th.card} 80%,${th.rd}08 100%)`}:{})}}>
    {isNew&&<span style={{position:"absolute",top:"7px",right:"9px",background:th.gn,color:"#fff",fontSize:"8px",fontWeight:800,padding:"2px 6px",borderRadius:"4px",textTransform:"uppercase"}}>Nové</span>}
    {fg&&!isDn&&<span style={{position:"absolute",top:"7px",right:isNew?"50px":"9px",background:th.pp,color:"#fff",fontSize:"8px",fontWeight:800,padding:"2px 6px",borderRadius:"4px"}}>30+d</span>}

    <div style={{display:"flex",alignItems:"flex-start",gap:"10px"}}>
      {!isDn&&canAct?<button onClick={quickComplete} style={{width:"22px",height:"22px",minWidth:"22px",marginTop:"1px",borderRadius:"6px",border:`2px solid ${inPr?th.yl:th.td}`,background:inPr?`${th.yl}15`:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:inPr?th.yl:th.tm,fontSize:"10px",fontWeight:700}} title="Splnit">{inPr?"◐":"○"}</button>
      :<div style={{width:"22px",height:"22px",minWidth:"22px",marginTop:"1px",borderRadius:"6px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",fontWeight:700,background:t.status==="cancelled"?`${th.pl}15`:`${th.gn}18`,color:t.status==="cancelled"?th.pl:th.gn,border:`2px solid ${t.status==="cancelled"?th.pl+"30":th.gn+"35"}`}}>{t.status==="done"?"✓":"⊘"}</div>}

      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:"14px",fontWeight:500,color:isDn?th.ts:th.tx,textDecoration:isDn?"line-through":"none",opacity:isDn?0.7:1,lineHeight:1.4,wordBreak:"break-word"}}>{t.title}</div>
        <div style={{display:"flex",alignItems:"center",gap:"6px",marginTop:"4px",flexWrap:"wrap"}}>
          <span style={{fontSize:"10px",fontWeight:700,color:pcs[p.id],textTransform:"uppercase"}}>● {p.label}</span>
          {t.category&&t.category!=="other"&&<span style={{fontSize:"10px",color:th.tm}}>{gc(t.category).icon}</span>}
          {clT>0&&<span style={{display:"inline-flex",alignItems:"center",gap:"3px"}}><span style={{width:"32px",height:"4px",borderRadius:"2px",background:th.ibr,overflow:"hidden",display:"inline-block"}}><span style={{display:"block",height:"100%",width:`${clT>0?clD/clT*100:0}%`,background:clD===clT&&clT>0?th.gn:th.ac,borderRadius:"2px",transition:"width 0.3s"}}/></span><span style={{fontSize:"10px",color:th.ts,fontWeight:600}}>{clD}/{clT}</span></span>}
          {t.assignTo==="both"&&<span style={{display:"inline-flex",gap:"2px"}}>{users.map(u=><span key={u.name} title={u.name} style={{width:7,height:7,borderRadius:"50%",background:t.doneBy?.includes(u.name)?th.gn:th.ibr,border:`1px solid ${t.doneBy?.includes(u.name)?th.gn:th.td}`}}/>)}</span>}
          {aLabel&&<span style={{fontSize:"10px",color:th.tm}}>{aLabel}</span>}
          {t.recDays>0&&<span style={{fontSize:"10px",color:th.ts}}>🔄</span>}
          {t.images?.length>0&&<span style={{fontSize:"10px",color:th.ts}}>📷</span>}
          {t.dueDate&&<span style={{fontSize:"10px",fontWeight:600,color:overdue?th.rd:soon?th.yl:th.tm}}>{overdue?"⚠ ":""}{fd(t.dueDate)}</span>}
          {isDn&&t.completedByUser&&<span style={{fontSize:"10px",color:th.tm}}>✓ {t.completedByUser}</span>}
        </div>
      </div>
      <span style={{fontSize:"9px",color:th.td,marginTop:"5px"}}>{open?"▲":"▼"}</span>
    </div>

    {open&&<TaskDetail task={t} user={user} users={users} onUpdate={onUpdate} onStatus={onStatus} th={th}/>}
  </div>);
}

/* ═══════════════════════════════════════════
   QUICK ADD BAR
   ═══════════════════════════════════════════ */
function QuickAdd({user,users,onAdd,th}){
  const[v,setV]=useState("");
  const[showFull,setShowFull]=useState(false);
  const[note,setNote]=useState("");
  const[type,setType]=useState("simple");
  const[assign,setAssign]=useState("self");
  const[prio,setPrio]=useState("important");
  const[due,setDue]=useState("");
  const[rec,setRec]=useState(0);
  const[cat,setCat]=useState("other");
  const ref=useRef();
  const others=users.filter(u=>u.name!==user.name);

  const makeTask=(title)=>({
    id:uid(),title,note:note.trim()||null,type,createdBy:user.name,
    assignTo:assign==="person"?"person":assign,
    assignedTo:assign==="self"?[user.name]:assign==="person"?[others[0]?.name||user.name]:users.map(u=>u.name),
    priority:prio,dueDate:due||null,recDays:rec,category:cat,activeMo:[],
    status:"active",doneBy:[],seenBy:[user.name],
    createdAt:new Date().toISOString(),completedAt:null,completedByUser:null,
    checklist:[],images:[],
  });

  const quickSubmit=()=>{
    if(!v.trim())return;
    onAdd(makeTask(v.trim()));
    setV("");ref.current?.focus();
  };

  const fullSubmit=()=>{
    if(!v.trim())return;
    onAdd(makeTask(v.trim()));
    setV("");setNote("");setDue("");setRec(0);setPrio("important");setAssign("self");setCat("other");setType("simple");
    setShowFull(false);
  };

  const cancel=()=>{setShowFull(false);setNote("");setDue("");setRec(0);setPrio("important");setAssign("self");setCat("other");setType("simple")};
  const lb={fontSize:"10px",color:th.tm,fontWeight:700,marginBottom:"3px",textTransform:"uppercase",letterSpacing:"0.3px"};
  const qd=[{l:"Dnes",v:addD(0)},{l:"Zítra",v:addD(1)},{l:"3d",v:addD(3)},{l:"Týden",v:addD(7)},{l:"14d",v:addD(14)},{l:"Měsíc",v:addD(30)}];

  return(<div style={{marginBottom:"14px"}}>
    {/* Always visible quick input */}
    <div style={{...cS(th),padding:"8px 10px",display:"flex",gap:"6px",alignItems:"center"}}>
      <input ref={ref} type="text" placeholder="Nový úkol — napiš a stiskni Enter..." value={v} onChange={e=>setV(e.target.value)}
        onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!showFull)quickSubmit()}}
        style={{...iS(th),border:"none",background:"transparent",padding:"6px 4px",fontSize:"14px",flex:1}}/>
      <button onClick={()=>setShowFull(!showFull)} title="Podrobnosti" style={{...bS(),width:"32px",height:"32px",background:showFull?th.ac:th.ib,color:showFull?"#fff":th.ts,border:`1px solid ${showFull?th.ac:th.ibr}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px",borderRadius:"8px",flexShrink:0}}>
        {showFull?"×":"⚙"}
      </button>
    </div>

    {/* Extended form */}
    {showFull&&<div style={{...cS(th),padding:"12px",marginTop:"6px",animation:"sUp 0.2s"}}>
      {/* Type */}
      <div style={{display:"flex",gap:"0",marginBottom:"10px",border:`1px solid ${th.cb}`,borderRadius:"8px",overflow:"hidden"}}>
        {[{id:"simple",l:"✓ Jednoduchý"},{id:"complex",l:"☰ S checklistem"}].map(tp=>(
          <button key={tp.id} onClick={()=>setType(tp.id)} style={{...bS(),flex:1,padding:"8px",fontSize:"11px",borderRadius:0,background:type===tp.id?th.ac:"transparent",color:type===tp.id?"#fff":th.ts,border:"none"}}>{tp.l}</button>
        ))}
      </div>

      <textarea placeholder="Poznámka..." value={note} onChange={e=>setNote(e.target.value)} rows={2} style={{...iS(th),fontSize:"13px",marginBottom:"8px",resize:"vertical",lineHeight:1.4}}/>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px",marginBottom:"8px"}}>
        <div><div style={lb}>Pro koho</div><select value={assign} onChange={e=>setAssign(e.target.value)} style={{...iS(th),padding:"8px",fontSize:"12px"}}><option value="self">Pro mě</option>{others.length===1&&<option value="person">Pro {others[0].name}</option>}{others.length>1&&<option value="person">Pro konkrétního</option>}<option value="both">Pro všechny</option></select></div>
        <div><div style={lb}>Priorita</div><select value={prio} onChange={e=>setPrio(e.target.value)} style={{...iS(th),padding:"8px",fontSize:"12px"}}>{PRI.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
        <div><div style={lb}>Kategorie</div><select value={cat} onChange={e=>setCat(e.target.value)} style={{...iS(th),padding:"8px",fontSize:"12px"}}>{CATS.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}</select></div>
        <div><div style={lb}>Opakování</div><select value={rec} onChange={e=>setRec(Number(e.target.value))} style={{...iS(th),padding:"8px",fontSize:"12px"}}>{REC.map(r=><option key={r.v} value={r.v}>{r.l}</option>)}</select></div>
      </div>

      {/* Quick dates */}
      <div style={{marginBottom:"8px"}}><div style={lb}>Termín</div>
        <div style={{display:"flex",gap:"3px",flexWrap:"wrap",marginBottom:"4px"}}>
          {qd.map(q=><button key={q.l} onClick={()=>setDue(q.v)} style={{...bS(),padding:"4px 7px",fontSize:"10px",background:due===q.v?th.acs:th.ib,color:due===q.v?th.ac:th.ts,border:`1px solid ${due===q.v?th.acb:th.ibr}`}}>{q.l}</button>)}
          {due&&<button onClick={()=>setDue("")} style={{...bS(),padding:"4px 7px",fontSize:"10px",background:"transparent",color:th.rd,border:`1px solid ${th.rd}25`}}>✕</button>}
        </div>
        <input type="date" value={due} onChange={e=>setDue(e.target.value)} style={{...iS(th),fontSize:"12px",padding:"6px 10px"}}/>
      </div>

      <div style={{display:"flex",gap:"8px"}}>
        <button onClick={fullSubmit} style={{...bS(),flex:1,padding:"11px",background:th.ac,color:"#fff",fontSize:"14px"}}>Přidat úkol</button>
        <button onClick={cancel} style={{...bS(),padding:"11px 16px",background:"transparent",color:th.ts,border:`1px solid ${th.cb}`,fontSize:"14px"}}>Storno</button>
      </div>
    </div>}
  </div>);
}

/* ═══════════════════════════════════════════
   STATS BAR
   ═══════════════════════════════════════════ */
function Stats({tasks,user,users,th}){
  const wa=new Date();wa.setDate(wa.getDate()-7);
  const ma=new Date();ma.setDate(ma.getDate()-30);
  const myActive=tasks.filter(t=>!dn(t)&&t.assignedTo?.includes(user.name));
  const doneWeek=tasks.filter(t=>t.status==="done"&&t.completedAt&&new Date(t.completedAt)>=wa&&t.assignedTo?.includes(user.name)).length;
  const doneMonth=tasks.filter(t=>t.status==="done"&&t.completedAt&&new Date(t.completedAt)>=ma&&t.assignedTo?.includes(user.name)).length;
  const overdue=myActive.filter(t=>dd(t.dueDate)<0).length;
  // Per-user stats
  const perUser=users.map(u=>({name:u.name,done:tasks.filter(t=>t.status==="done"&&t.completedAt&&new Date(t.completedAt)>=wa&&t.completedByUser===u.name).length}));

  return(<div style={{...cS(th),padding:"12px 14px",marginBottom:"14px"}}>
    <div style={{display:"flex",gap:"4px",marginBottom:perUser.length>1?"8px":"0"}}>
      {[{v:myActive.length,l:"Zbývá",c:th.ac},{v:doneWeek,l:"Týden",c:th.gn},{v:doneMonth,l:"Měsíc",c:th.gn+"99"},{v:overdue,l:"Po termínu",c:overdue>0?th.rd:th.td}].map((s,i)=>(
        <div key={i} style={{flex:"1 1 0",textAlign:"center"}}>
          <div style={{fontSize:"18px",fontWeight:700,color:s.c}}>{s.v}</div>
          <div style={{fontSize:"9px",color:th.tm,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.2px",marginTop:"1px"}}>{s.l}</div>
        </div>
      ))}
    </div>
    {perUser.length>1&&<div style={{display:"flex",gap:"8px",justifyContent:"center",paddingTop:"6px",borderTop:`1px solid ${th.cb}`}}>
      {perUser.map(u=><span key={u.name} style={{fontSize:"10px",color:th.ts}}>{u.name}: <strong style={{color:th.gn}}>{u.done}</strong> tento týden</span>)}
    </div>}
  </div>);
}

/* ═══════════════════════════════════════════
   SETUP / LOGIN / ADMIN
   ═══════════════════════════════════════════ */
function Setup({onDone}){
  const[n,setN]=useState("");const[p,setP]=useState("");const[busy,setBusy]=useState(false);const th=TH.dark;
  return(<div style={{minHeight:"100vh",background:th.bg,fontFamily:F,color:th.tx,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}><style>{CSS}</style>
    <div style={{width:"300px",textAlign:"center",animation:"fIn 0.4s"}}>
      <div style={{fontSize:"24px",fontWeight:700,marginBottom:"4px"}}>Rodinné úkoly</div>
      <div style={{fontSize:"12px",color:th.ts,marginBottom:"28px"}}>První spuštění — vytvoř hlavního uživatele</div>
      <input placeholder="Tvoje jméno" value={n} onChange={e=>setN(e.target.value)} style={{...iS(th),padding:"12px",fontSize:"15px",marginBottom:"10px",textAlign:"center"}}/>
      <input placeholder="4místný PIN" value={p} onChange={e=>{if(/^\d{0,4}$/.test(e.target.value))setP(e.target.value)}} type="tel" inputMode="numeric" maxLength={4} style={{...iS(th),padding:"12px",fontSize:"20px",marginBottom:"16px",textAlign:"center",letterSpacing:"8px"}}/>
      <button onClick={async()=>{if(n.trim()&&p.length===4){setBusy(true);await onDone({name:n.trim(),pin:p,admin:true})}}} disabled={!n.trim()||p.length!==4||busy} style={{...bS(),width:"100%",padding:"12px",background:n.trim()&&p.length===4?th.ac:th.bb,color:"#fff",fontSize:"14px",opacity:!n.trim()||p.length!==4||busy?0.4:1}}>{busy?"Vytvářím...":"Vytvořit účet"}</button>
    </div>
  </div>);
}

function Login({users,onLogin,theme}){
  const[sel,setSel]=useState(null);const[pin,setPin]=useState("");const[err,setErr]=useState(false);const th=TH[theme];
  const tryL=()=>{const u=users.find(u=>u.name===sel);if(u&&u.pin===pin){setErr(false);onLogin(u)}else{setErr(true);setPin("")}};
  return(<div style={{minHeight:"100vh",background:th.bg,fontFamily:F,color:th.tx,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}><style>{CSS}</style>
    <div style={{width:"320px",textAlign:"center",animation:"fIn 0.4s"}}>
      <div style={{fontSize:"24px",fontWeight:700,marginBottom:"4px"}}>Rodinné úkoly</div>
      <div style={{fontSize:"12px",color:th.ts,marginBottom:"28px"}}>Vyber se a zadej PIN</div>
      {!sel?<div style={{display:"flex",flexDirection:"column",gap:"8px"}}>{users.map(u=>(<button key={u.name} onClick={()=>setSel(u.name)} style={{...cS(th),padding:"16px",fontSize:"16px",fontWeight:600,color:th.tx,cursor:"pointer",fontFamily:F,textAlign:"left",display:"flex",alignItems:"center",justifyContent:"space-between"}}><span>{u.name}</span>{u.admin&&<span style={{fontSize:"10px",color:th.ts,background:th.acs,padding:"2px 6px",borderRadius:"4px"}}>admin</span>}</button>))}</div>
      :<div style={{animation:"sUp 0.2s"}}><div style={{fontSize:"16px",fontWeight:600,marginBottom:"16px"}}>{sel}</div>
        <input placeholder="PIN" value={pin} onChange={e=>{if(/^\d{0,4}$/.test(e.target.value)){setPin(e.target.value);setErr(false)}}} onKeyDown={e=>e.key==="Enter"&&pin.length===4&&tryL()} type="tel" inputMode="numeric" maxLength={4} autoFocus style={{...iS(th),padding:"12px",fontSize:"22px",marginBottom:"8px",textAlign:"center",letterSpacing:"10px",borderColor:err?th.rd:th.ibr}}/>
        {err&&<div style={{fontSize:"12px",color:th.rd,marginBottom:"8px"}}>Špatný PIN</div>}
        <button onClick={tryL} disabled={pin.length!==4} style={{...bS(),width:"100%",padding:"11px",background:pin.length===4?th.ac:th.bb,color:"#fff",fontSize:"14px",opacity:pin.length===4?1:0.4,marginBottom:"8px"}}>Přihlásit</button>
        <button onClick={()=>{setSel(null);setPin("");setErr(false)}} style={{background:"none",border:"none",color:th.ts,fontSize:"12px",cursor:"pointer",fontFamily:F}}>← Zpět</button>
      </div>}
    </div>
  </div>);
}

function Admin({users,onAdd,onRemove,onClose,th}){
  const[n,setN]=useState("");const[p,setP]=useState("");
  return(<div style={{...cS(th),padding:"16px",marginBottom:"14px",animation:"sUp 0.2s"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}><span style={{fontSize:"14px",fontWeight:700}}>Správa uživatelů</span><button onClick={onClose} style={{background:"none",border:"none",color:th.ts,cursor:"pointer",fontSize:"18px"}}>×</button></div>
    {users.map(u=>(<div key={u.name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${th.cb}`}}><span style={{fontSize:"13px"}}>{u.name} {u.admin&&<span style={{fontSize:"10px",color:th.ts}}>(admin)</span>}</span>{!u.admin&&<button onClick={()=>onRemove(u.name)} style={{background:"none",border:"none",color:th.rd,fontSize:"11px",cursor:"pointer",fontFamily:F,fontWeight:600}}>Odebrat</button>}</div>))}
    <div style={{display:"flex",gap:"6px",marginTop:"12px"}}><input placeholder="Jméno" value={n} onChange={e=>setN(e.target.value)} style={{...iS(th),flex:1}}/><input placeholder="PIN" value={p} onChange={e=>{if(/^\d{0,4}$/.test(e.target.value))setP(e.target.value)}} type="tel" inputMode="numeric" maxLength={4} style={{...iS(th),width:"70px",textAlign:"center",letterSpacing:"4px"}}/><button onClick={()=>{if(n.trim()&&p.length===4&&!users.find(u=>u.name===n.trim())){onAdd({name:n.trim(),pin:p,admin:false});setN("");setP("")}}} style={{...bS(),padding:"8px 14px",background:th.ac,color:"#fff",fontSize:"14px"}}>+</button></div>
  </div>);
}

function Snack({msg,onUndo,vis,th}){
  if(!vis)return null;
  return<div style={{position:"fixed",bottom:"24px",left:"50%",transform:"translateX(-50%)",background:th.sb,border:`1px solid ${th.cb}`,borderRadius:"12px",padding:"12px 16px",display:"flex",alignItems:"center",gap:"12px",zIndex:100,animation:"snIn 0.25s ease",fontFamily:F,boxShadow:"0 8px 32px rgba(0,0,0,0.4)",maxWidth:"90vw"}}><span style={{fontSize:"13px",color:th.tx}}>{msg}</span><button onClick={onUndo} style={{...bS(),background:th.ac,color:"#fff",padding:"6px 14px",fontSize:"12px"}}>VRÁTIT</button></div>;
}

/* ═══════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════ */
export default function App(){
  const[tasks,setTasks]=useState([]);
  const[users,setUsers]=useState(null);
  const[user,setUser]=useState(null);
  const[loading,setLoading]=useState(true);
  const[online,setOnline]=useState(navigator.onLine);
  const[filter,setFilter]=useState("my");
  const[vs,setVs]=useState("active");
  const[sort,setSort]=useState("smart");
  const[catF,setCatF]=useState("all");
  const[search,setSearch]=useState("");
  const[undo,setUndo]=useState(null);
  const[theme,setTheme]=useState(()=>{try{return localStorage.getItem("ft_theme")||"dark"}catch(e){return"dark"}});
  const[showAdmin,setShowAdmin]=useState(false);
  const ut=useRef();

  // Online/offline
  useEffect(()=>{const on=()=>setOnline(true);const off=()=>setOnline(false);window.addEventListener("online",on);window.addEventListener("offline",off);return()=>{window.removeEventListener("online",on);window.removeEventListener("offline",off)}},[]);

  // Session restore
  useEffect(()=>{try{const s=localStorage.getItem("ft_user");if(s)setUser(JSON.parse(s))}catch(e){}},[]);
  useEffect(()=>{try{if(user)localStorage.setItem("ft_user",JSON.stringify(user));else localStorage.removeItem("ft_user")}catch(e){}},[user]);
  useEffect(()=>{try{localStorage.setItem("ft_theme",theme)}catch(e){}},[theme]);

  // Load data
  useEffect(()=>{(async()=>{const[u,t]=await Promise.all([aLU(),aLT()]);setUsers(u);const{tasks:p,updates}=processRec(t);setTasks(p);if(updates.length>0)aUTs(updates);setLoading(false)})();if("Notification"in window&&Notification.permission==="default")Notification.requestPermission()},[]);

  // Realtime
  useEffect(()=>{if(loading)return;
    const tc=supabase.channel("t9").on("postgres_changes",{event:"*",schema:"public",table:"tasks"},p=>{
      if(p.eventType==="INSERT")setTasks(prev=>prev.find(t=>t.id===p.new.id)?prev:[dbToTask(p.new),...prev]);
      else if(p.eventType==="UPDATE")setTasks(prev=>prev.map(t=>t.id===p.new.id?dbToTask(p.new):t));
      else if(p.eventType==="DELETE")setTasks(prev=>prev.filter(t=>t.id!==p.old.id));
    }).subscribe();
    const uc=supabase.channel("u9").on("postgres_changes",{event:"*",schema:"public",table:"users"},()=>{aLU().then(setUsers)}).subscribe();
    return()=>{supabase.removeChannel(tc);supabase.removeChannel(uc)};
  },[loading]);

  // Recurring + keepalive
  useEffect(()=>{const iv=setInterval(()=>{setTasks(p=>{const{tasks:u2,updates}=processRec(p);if(updates.length>0)aUTs(updates);return updates.length>0?u2:p});supabase.from("tasks").select("id",{count:"exact",head:true})},60000);return()=>clearInterval(iv)},[]);

  const th=TH[theme];
  const toggleTheme=()=>setTheme(theme==="dark"?"light":"dark");

  const addUser=useCallback(async u=>{await aCU(u)},[]);
  const removeUser=useCallback(async n=>{await aDU(n)},[]);

  const doUndo=useCallback(async()=>{if(!undo)return;setTasks(undo.prev);const t=undo.prev.find(t=>t.id===undo.tid);if(t)aUT(t);clearTimeout(ut.current);setUndo(null)},[undo]);
  const withUndo=useCallback((msg,tid,fn)=>{setTasks(prev=>{const nx=fn(prev);const upd=nx.find(t=>t.id===tid);if(upd)aUT(upd);setUndo({prev,msg,tid});clearTimeout(ut.current);ut.current=setTimeout(()=>setUndo(null),UNDO_MS);return nx})},[]);

  const addTask=useCallback(async t=>{setTasks(p=>[t,...p]);await aCT(t);if(t.assignTo!=="self")noti(`📋 Nový od ${t.createdBy}`,t.title)},[]);

  const chgStatus=useCallback((id,action)=>{
    const m={done:"Splněno",done_all:"Splněno",done_my:"Moje část hotová",cancelled:"Nerealizováno",reopen:"Vráceno",in_progress:"Rozpracováno"}[action]||"Změněno";
    withUndo(m,id,prev=>prev.map(t=>{
      if(t.id!==id)return t;const now=new Date().toISOString();
      if(action==="in_progress")return{...t,status:"in_progress"};
      if(action==="cancelled")return{...t,status:"cancelled",completedAt:now,completedByUser:user.name};
      if(action==="done")return{...t,status:"done",completedAt:now,completedByUser:user.name,doneBy:users.map(u=>u.name)};
      if(action==="done_my"){const nb=[...new Set([...(t.doneBy||[]),user.name])];const all=users.every(u=>nb.includes(u.name));return{...t,doneBy:nb,status:all?"done":t.status,completedAt:all?now:t.completedAt,completedByUser:all?user.name:t.completedByUser}}
      if(action==="done_all")return{...t,status:"done",completedAt:now,completedByUser:user.name,doneBy:users.map(u=>u.name)};
      if(action==="reopen")return{...t,status:"active",completedAt:null,completedByUser:null,doneBy:[]};
      return t;
    }));
  },[user,users,withUndo]);

  const markSeen=useCallback(async id=>{const t=tasks.find(t=>t.id===id);if(!t||t.seenBy?.includes(user.name))return;const upd={...t,seenBy:[...(t.seenBy||[]),user.name]};setTasks(p=>p.map(x=>x.id===id?upd:x));await aUT(upd)},[tasks,user]);

  const updateTask=useCallback(async(id,patch)=>{const t=tasks.find(t=>t.id===id);if(!t)return;const upd={...t,...patch};setTasks(p=>p.map(x=>x.id===id?upd:x));await aUT(upd)},[tasks]);

  const unread=useMemo(()=>{if(!user||!users)return{};const r={};users.forEach(u=>{r[u.name]=tasks.filter(t=>!t.seenBy?.includes(u.name)&&t.createdBy!==u.name&&!dn(t)).length});return r},[tasks,user,users]);

  const filtered=useMemo(()=>{
    if(!user)return[];let l=tasks;
    if(vs==="active")l=l.filter(t=>!dn(t));else if(vs==="done")l=l.filter(t=>t.status==="done");else if(vs==="cancelled")l=l.filter(t=>t.status==="cancelled");
    if(filter==="my")l=l.filter(t=>t.assignedTo?.includes(user.name));
    else if(filter==="assigned")l=l.filter(t=>t.createdBy===user.name&&!t.assignedTo?.every(a=>a===user.name));
    else if(filter==="shared")l=l.filter(t=>t.assignTo==="both");
    else if(filter==="unread")l=l.filter(t=>!t.seenBy?.includes(user.name)&&t.createdBy!==user.name);
    if(catF!=="all")l=l.filter(t=>t.category===catF);
    if(search)l=l.filter(t=>searchMatch(t,search));
    if(sort==="smart")l=[...l].sort(ssort);
    else if(sort==="priority")l=[...l].sort((a,b)=>gp(a.priority).w-gp(b.priority).w);
    else if(sort==="date")l=[...l].sort((a,b)=>dd(a.dueDate)-dd(b.dueDate));
    else if(sort==="created")l=[...l].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    return l;
  },[tasks,user,filter,vs,sort,catF,search]);

  const stats=useMemo(()=>{if(!user)return{};const a=tasks.filter(t=>!dn(t));return{my:a.filter(t=>t.assignedTo?.includes(user.name)).length,out:a.filter(t=>t.createdBy===user.name&&!t.assignedTo?.every(x=>x===user.name)).length,shared:a.filter(t=>t.assignTo==="both").length}},[tasks,user]);

  // Category counts for filter
  const catCounts=useMemo(()=>{const active=tasks.filter(t=>vs==="active"?!dn(t):vs==="done"?t.status==="done":t.status==="cancelled");const c={};CATS.forEach(cat=>{c[cat.id]=active.filter(t=>t.category===cat.id).length});return c},[tasks,vs]);

  if(loading)return<div style={{minHeight:"100vh",background:"#0c1017",display:"flex",alignItems:"center",justifyContent:"center",color:"#506880",fontFamily:F}}>Načítám...</div>;
  if(!users?.length)return<Setup onDone={async u=>{await aCU(u);setUsers([u]);setUser(u)}}/>;
  if(!user)return<Login users={users} onLogin={setUser} theme={theme}/>;

  return(<div style={{minHeight:"100vh",background:th.bg,fontFamily:F,color:th.tx,WebkitFontSmoothing:"antialiased"}}>
    <style>{CSS}</style>

    {/* Header */}
    <div style={{background:th.hdr,backdropFilter:"blur(20px)",borderBottom:`1px solid ${th.cb}`,padding:"11px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:30}}>
      <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
        <span style={{fontWeight:700,fontSize:"15px"}}>Úkoly</span>
        <button onClick={toggleTheme} style={{background:"none",border:"none",cursor:"pointer",fontSize:"14px",padding:"2px"}}>{theme==="dark"?"☀️":"🌙"}</button>
        {!online&&<span style={{fontSize:"9px",background:th.rd,color:"#fff",padding:"2px 6px",borderRadius:"4px",fontWeight:700}}>OFFLINE</span>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
        {users.filter(u=>u.name!==user.name).map(u=>unread[u.name]>0?<span key={u.name} style={{fontSize:"10px",color:th.ts}}>{u.name}: <span style={{background:th.yl,color:"#fff",borderRadius:"8px",padding:"1px 5px",fontSize:"9px",fontWeight:800}}>{unread[u.name]}</span></span>:null)}
        {user.admin&&<button onClick={()=>setShowAdmin(!showAdmin)} style={{background:"none",border:"none",color:th.ts,cursor:"pointer",fontSize:"13px"}}>⚙️</button>}
        <button onClick={()=>setUser(null)} style={{...bS(),background:th.ib,border:`1px solid ${th.ibr}`,color:th.ts,padding:"5px 10px",fontSize:"11px",display:"flex",alignItems:"center",gap:"4px"}}>{user.name}</button>
      </div>
    </div>

    <div style={{maxWidth:"560px",margin:"0 auto",padding:"14px 12px 140px"}}>
      {showAdmin&&user.admin&&<Admin users={users} onAdd={addUser} onRemove={removeUser} onClose={()=>setShowAdmin(false)} th={th}/>}

      <Stats tasks={tasks} user={user} users={users} th={th}/>

      {/* QUICK ADD — always visible */}
      <QuickAdd user={user} users={users} onAdd={addTask} th={th}/>

      {/* SEARCH */}
      <div style={{marginBottom:"10px"}}>
        <input type="text" placeholder="🔍 Hledat v úkolech..." value={search} onChange={e=>setSearch(e.target.value)}
          style={{...iS(th),fontSize:"13px",padding:"8px 12px",background:search?th.acs:th.ib,border:`1px solid ${search?th.acb:th.ibr}`}}/>
      </div>

      {/* Filter tabs */}
      <div style={{display:"flex",gap:"3px",marginBottom:"6px",overflowX:"auto",paddingBottom:"2px"}}>
        {[{id:"my",l:"Moje",n:stats.my},{id:"assigned",l:"Zadané",n:stats.out},{id:"shared",l:"Společné",n:stats.shared},{id:"unread",l:"Nové",n:unread[user.name]},{id:"all",l:"Vše"}].map(tab=>(
          <button key={tab.id} onClick={()=>setFilter(tab.id)} style={{...bS(),padding:"6px 10px",fontSize:"11px",background:filter===tab.id?th.acs:"transparent",color:filter===tab.id?th.ac:th.tm,border:filter===tab.id?`1px solid ${th.acb}`:"1px solid transparent",display:"flex",alignItems:"center",gap:"4px",whiteSpace:"nowrap"}}>
            {tab.l}{tab.n>0&&<span style={{background:filter===tab.id?th.ac:th.bb,color:filter===tab.id?"#fff":th.ts,borderRadius:"8px",padding:"0 5px",fontSize:"9px",fontWeight:800}}>{tab.n}</span>}
          </button>
        ))}
      </div>

      {/* Status + sort */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"6px",gap:"6px"}}>
        <div style={{display:"flex",gap:"2px"}}>
          {[{id:"active",l:"Aktivní"},{id:"done",l:"Splněné"},{id:"cancelled",l:"Nerealizované"}].map(v=>(
            <button key={v.id} onClick={()=>setVs(v.id)} style={{...bS(),padding:"4px 8px",fontSize:"10px",background:vs===v.id?th.bb:"transparent",color:vs===v.id?th.tx:th.td}}>{v.l}</button>
          ))}
        </div>
        <select value={sort} onChange={e=>setSort(e.target.value)} style={{...iS(th),width:"auto",padding:"3px 6px",fontSize:"10px",background:"transparent",border:`1px solid ${th.ibr}`}}>
          {[{id:"smart",l:"↕ Chytré"},{id:"priority",l:"↕ Priorita"},{id:"date",l:"↕ Termín"},{id:"created",l:"↕ Nejnovější"}].map(s=><option key={s.id} value={s.id}>{s.l}</option>)}
        </select>
      </div>

      {/* Category filter — improved */}
      <div style={{display:"flex",gap:"3px",marginBottom:"12px",overflowX:"auto",paddingBottom:"2px"}}>
        <button onClick={()=>setCatF("all")} style={{...bS(),padding:"4px 10px",fontSize:"10px",background:catF==="all"?th.bb:"transparent",color:catF==="all"?th.tx:th.td,whiteSpace:"nowrap",borderRadius:"16px",border:`1px solid ${catF==="all"?th.cb:"transparent"}`}}>Vše</button>
        {CATS.map(c=>{const cnt=catCounts[c.id]||0;if(cnt===0&&catF!==c.id)return null;
          return<button key={c.id} onClick={()=>setCatF(catF===c.id?"all":c.id)} style={{...bS(),padding:"4px 9px",fontSize:"10px",background:catF===c.id?th.bb:"transparent",color:catF===c.id?th.tx:th.td,whiteSpace:"nowrap",borderRadius:"16px",border:`1px solid ${catF===c.id?th.cb:"transparent"}`,display:"flex",alignItems:"center",gap:"3px"}}>{c.icon}<span>{c.label}</span><span style={{fontSize:"9px",opacity:0.6}}>{cnt}</span></button>;
        })}
      </div>

      {/* Task list */}
      {filtered.length===0?(
        <div style={{textAlign:"center",color:th.td,padding:"50px 20px"}}>
          <div style={{fontSize:"28px",marginBottom:"8px"}}>{search?"🔍":vs==="active"?"🎉":vs==="done"?"📭":"✨"}</div>
          <div style={{fontSize:"13px",fontWeight:500,color:th.tm}}>{search?"Nic nenalezeno":vs==="active"?"Žádné aktivní úkoly":vs==="done"?"Zatím nic splněného":"Žádné nerealizované"}</div>
          {search&&<button onClick={()=>setSearch("")} style={{...bS(),marginTop:"8px",padding:"6px 14px",fontSize:"12px",background:th.ib,color:th.ts,border:`1px solid ${th.ibr}`}}>Zrušit hledání</button>}
        </div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:"5px"}}>
          {filtered.map(t=><TaskCard key={t.id} task={t} user={user} users={users} onStatus={chgStatus} onSeen={markSeen} onUpdate={updateTask} th={th}/>)}
        </div>
      )}
    </div>

    <Snack msg={undo?.msg} vis={!!undo} onUndo={doUndo} th={th}/>
  </div>);
}
