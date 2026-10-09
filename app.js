document.getElementById("submit").onclick=async()=>{
 const msg=document.getElementById("msg"), name=document.getElementById("name").value.trim(), roll=document.getElementById("roll").value.trim(), utr=document.getElementById("utr").value.trim();
 if(!name||!roll||!utr){msg.className="error";msg.textContent="Please complete all fields.";return}
 const r=await fetch("/api/payments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,roll,utr})});
 const d=await r.json(); if(!r.ok){msg.className="error";msg.textContent=d.error;return}
 msg.className="successbox";msg.innerHTML=`Submitted successfully. Status: <b>Pending</b>. <a href="status.html">Check status</a>`;
 document.querySelectorAll("input").forEach(x=>x.value="");
};