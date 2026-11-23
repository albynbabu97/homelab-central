import os, subprocess
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
app=FastAPI(title='Homelab Central Host Helper')
TOKEN=os.environ.get('HOST_HELPER_TOKEN','')
COMMANDS={'reboot':['/usr/bin/sudo','-n','/usr/bin/systemctl','reboot'],'shutdown':['/usr/bin/sudo','-n','/usr/bin/systemctl','poweroff'],'docker-restart':['/usr/bin/sudo','-n','/usr/bin/systemctl','restart','docker']}
def authorize(auth):
    if not TOKEN or auth != f'Bearer {TOKEN}': raise HTTPException(status_code=401,detail='unauthorized')
@app.get('/health')
def health(authorization:str|None=Header(default=None)):
    authorize(authorization);return {'status':'ok'}
@app.post('/operations/{operation}')
def operation(operation:str,authorization:str|None=Header(default=None)):
    authorize(authorization)
    if operation not in COMMANDS: raise HTTPException(status_code=404,detail='operation not allowed')
    try:
        subprocess.Popen(COMMANDS[operation],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
        return JSONResponse({'accepted':True,'operation':operation},status_code=202)
    except Exception: raise HTTPException(status_code=503,detail='host operation failed')
@app.get('/metrics')
def metrics(authorization:str|None=Header(default=None)):
    authorize(authorization)
    import time, shutil
    def cpu_ticks():
        fields=open('/proc/stat').readline().split()[1:]
        vals=[int(x) for x in fields]
        idle=vals[3]+(vals[4] if len(vals)>4 else 0)
        return sum(vals),idle
    try:
        total1,idle1=cpu_ticks();time.sleep(0.15);total2,idle2=cpu_ticks()
        total=max(1,total2-total1);cpu=round((1-(idle2-idle1)/total)*100,1)
    except Exception: cpu=None
    mem={}
    try:
        for line in open('/proc/meminfo'):
            k,v=line.split(':',1);mem[k]=int(v.strip().split()[0])
        total=mem.get('MemTotal',0);available=mem.get('MemAvailable',0);memory=round((total-available)/total*100,1) if total else None
    except Exception: memory=None
    disk=shutil.disk_usage('/');disk_pct=round(disk.used/disk.total*100,1) if disk.total else None
    uptime_seconds=int(float(open('/proc/uptime').read().split()[0]))
    return {'hostname':os.uname().nodename,'cpu':cpu,'memory':memory,'disk':disk_pct,'uptime':f'{uptime_seconds//86400}d {(uptime_seconds%86400)//3600}h'}
