"""Verify Go station outbox reaches real local RabbitMQ and PostgreSQL in CI."""
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[1]

def main():
    if not os.environ.get('GATEWAY_TOKEN'):
        raise SystemExit('GATEWAY_TOKEN is required for the isolated Compose gateway')
    with tempfile.TemporaryDirectory(prefix='suite-station-outbox-') as directory:
        temp=Path(directory); binary=temp/('station.exe' if os.name=='nt' else 'station'); db_path=temp/'station.sqlite'
        subprocess.run(['go','build','-o',str(binary),'.'],cwd=ROOT/'backend',check=True)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
        env={**os.environ,'SUITE_ADDR':f'127.0.0.1:{port}','SUITE_DB':str(db_path),'SUITE_WEB':str(ROOT/'web-dist'),'INFRA_GATEWAY_URL':'http://127.0.0.1:8088','INFRA_GATEWAY_TOKEN':os.environ['GATEWAY_TOKEN']}
        flags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0
        process=subprocess.Popen([str(binary)],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=flags)
        base=f'http://127.0.0.1:{port}';opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        def req(path,body=None):
            request=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
            with opener.open(request,timeout=10) as response:
                value=json.load(response)
                if not value.get('success'): raise RuntimeError('Station API failed')
                return value['data']
        try:
            for _ in range(150):
                try: req('/api/health');break
                except OSError:
                    if process.poll() is not None: raise RuntimeError('Station process exited')
                    time.sleep(.1)
            else: raise RuntimeError('Station server did not start')
            req('/api/auth/login',{'email':'admin@suite.test','password':'SuiteDemo!2026','site':'shop'})
            identity=req('/api/auth/me?site=shop'); tenant='station_'+hashlib.sha256(identity['organizationId'].encode()).hexdigest()[:48]
            view=req('/api/stations/shop/data?view=back');variant=next(v for v in view['variants'] if v['stockQuantity']>0)
            checkout=req('/api/stations/shop/business',{'action':'checkout','variantId':variant['id'],'quantity':1,'idempotencyKey':'ci-checkout-00001'})
            order=checkout['orderId']; req('/api/stations/shop/business',{'action':'pay','orderId':order,'idempotencyKey':'ci-payment-000001'})
            event='shop.paid:'+order
            for _ in range(75):
                with sqlite3.connect(f'file:{db_path}?mode=ro',uri=True) as db:
                    row=db.execute('SELECT status FROM outbox_events WHERE id=?',(event,)).fetchone()
                if row and row[0]=='processed': break
                time.sleep(1)
            else: raise RuntimeError('Station outbox event was not published')
            code='''import os,sys,psycopg\nfrom runtime.policy import shard_for\ntenant,event,order=sys.argv[1:]\nwith psycopg.connect(os.environ[f'SHARD_{shard_for(tenant)}_URL']) as db:\n print(db.execute('SELECT count(*) FROM fulfillment_jobs WHERE tenant_id=%s AND event_id=%s AND order_id=%s',(tenant,event,order)).fetchone()[0])'''
            for _ in range(40):
                check=subprocess.run(['docker','compose','-f','compose.yaml','exec','-T','gateway','python','-c',code,tenant,event,order],cwd=ROOT/'infra',text=True,capture_output=True,check=True)
                if check.stdout.strip()=='1': break
                time.sleep(.5)
            else: raise RuntimeError('Fulfillment consumer did not create one job')
            print('PASS: Go checkout -> simulated payment -> outbox -> RabbitMQ -> exactly one PostgreSQL fulfillment job')
        finally:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill();process.wait()

if __name__=='__main__': main()
