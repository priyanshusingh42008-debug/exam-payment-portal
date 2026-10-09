const express=require("express");
const path=require("path");
const fs=require("fs");
const app=express();
const PORT=process.env.PORT||3000;
const DATA=path.join(__dirname,"payments.json");
if(!fs.existsSync(DATA)) fs.writeFileSync(DATA,"[]");
app.use(express.json());
app.use(express.static(__dirname));

function read(){return JSON.parse(fs.readFileSync(DATA,"utf8"))}
function write(x){fs.writeFileSync(DATA,JSON.stringify(x,null,2))}

app.post("/api/payments",(req,res)=>{
  const {name,roll,utr}=req.body||{};
  if(!name||!roll||!utr) return res.status(400).json({error:"All fields are required."});
  const items=read();
  const duplicate=items.find(x=>x.utr.toLowerCase()===String(utr).toLowerCase());
  if(duplicate) return res.status(409).json({error:"This transaction reference has already been submitted."});
  const item={id:Date.now().toString(),name,roll,utr,amount:2500,status:"Pending",createdAt:new Date().toISOString()};
  items.push(item); write(items);
  res.json({ok:true,id:item.id,status:item.status});
});

app.get("/api/payments",(req,res)=>res.json(read()));

app.post("/api/payments/:id/status",(req,res)=>{
  const allowed=["Pending","Verified","Rejected"];
  const status=req.body?.status;
  if(!allowed.includes(status)) return res.status(400).json({error:"Invalid status."});
  const items=read(); const item=items.find(x=>x.id===req.params.id);
  if(!item) return res.status(404).json({error:"Payment not found."});
  item.status=status; item.updatedAt=new Date().toISOString(); write(items);
  res.json({ok:true,item});
});

app.get("/api/payments/:id",(req,res)=>{
  const item=read().find(x=>x.id===req.params.id);
  if(!item) return res.status(404).json({error:"Payment not found."});
  res.json(item);
});

app.listen(PORT,()=>console.log(`Portal running on http://localhost:${PORT}`));
