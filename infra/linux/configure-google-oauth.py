#!/usr/bin/env python3
"""Import a Google Web OAuth client through private stdin; never emit credentials."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
from urllib.parse import urlsplit

class ConfigurationError(Exception):
    pass

def private_file(path):
    info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)!=0o600:
        raise ConfigurationError('Environment must be a private regular single-link file with mode 0600')
    if os.geteuid() not in (0,info.st_uid):
        raise ConfigurationError('Environment is not owned by this operator')
    parent=path.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_mode & 0o022:
        raise ConfigurationError('Environment parent must not be writable by other users')
    return info

def value(text,key):
    matches=[line.split('=',1)[1].strip() for line in text.splitlines() if '=' in line and line.split('=',1)[0].strip()==key]
    if len(matches)>1:
        raise ConfigurationError('Duplicate authentication setting requires manual review')
    result=matches[0] if matches else ''
    if len(result)>1 and result[0]==result[-1] and result[0] in "\"'":
        result=result[1:-1]
    return result

def configure(path,payload,replace=False):
    web=payload.get('web') if isinstance(payload,dict) else None
    if not isinstance(web,dict):
        raise ConfigurationError('A Google Web application client JSON is required')
    client=web.get('client_id');secret=web.get('client_secret')
    if not isinstance(client,str) or not re.fullmatch(r'[A-Za-z0-9._-]+\.apps\.googleusercontent\.com',client) or len(client)>4096:
        raise ConfigurationError('Invalid Google Web client ID')
    if not isinstance(secret,str) or not secret or len(secret)>4096 or any(ord(c)<32 or ord(c)==127 for c in secret):
        raise ConfigurationError('Invalid Google client secret')
    private_file(path)
    lock_path=path.with_name('.'+path.name+'.oauth.lock')
    lock=os.open(lock_path,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        if not stat.S_ISREG(os.fstat(lock).st_mode) or os.fstat(lock).st_nlink!=1 or stat.S_IMODE(os.fstat(lock).st_mode)!=0o600:
            raise ConfigurationError('Unsafe configuration lock')
        fcntl.flock(lock,fcntl.LOCK_EX)
        original=private_file(path)
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
        with os.fdopen(fd,'r',encoding='utf-8') as source:
            opened=os.fstat(source.fileno())
            if (opened.st_dev,opened.st_ino)!=(original.st_dev,original.st_ino):
                raise ConfigurationError('Environment changed during validation')
            text=source.read(1024*1024+1)
        if len(text)>1024*1024:
            raise ConfigurationError('Environment file is unexpectedly large')
        origin=value(text,'BETTER_AUTH_URL')
        parsed=urlsplit(origin)
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('','/'):
            raise ConfigurationError('Configure a canonical HTTPS BETTER_AUTH_URL first')
        callback=origin.rstrip('/')+'/api/workspace-auth/callback/google'
        redirects=web.get('redirect_uris')
        if not isinstance(redirects,list) or callback not in redirects:
            raise ConfigurationError('Google Web client is missing the configured application callback')
        if not value(text,'BETTER_AUTH_SECRET'):
            raise ConfigurationError('Configure the private authentication secret first')
        if not replace and (value(text,'GOOGLE_CLIENT_ID') or value(text,'GOOGLE_CLIENT_SECRET')):
            raise ConfigurationError('Google credentials already exist; use --replace for an intentional rotation')
        updates={'GOOGLE_CLIENT_ID':client,'GOOGLE_CLIENT_SECRET':secret}
        lines=[line for line in text.splitlines() if line.split('=',1)[0].strip() not in updates]
        # Double-quoted dotenv values use JSON-compatible escapes; $$ prevents interpolation.
        lines.extend(key+'='+json.dumps(item.replace('$','$$'),ensure_ascii=False) for key,item in updates.items())
        temp_fd,temp_name=tempfile.mkstemp(prefix='.google-oauth-',dir=path.parent)
        try:
            os.fchmod(temp_fd,0o600)
            if os.geteuid()==0:
                os.fchown(temp_fd,original.st_uid,original.st_gid)
            with os.fdopen(temp_fd,'w',encoding='utf-8') as target:
                target.write('\n'.join(lines)+'\n');target.flush();os.fsync(target.fileno())
            current=path.lstat()
            if (current.st_dev,current.st_ino)!=(original.st_dev,original.st_ino):
                raise ConfigurationError('Environment changed before replacement')
            os.replace(temp_name,path)
            directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
            try: os.fsync(directory)
            finally: os.close(directory)
        finally:
            if os.path.exists(temp_name): os.unlink(temp_name)
    finally:
        os.close(lock)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file',default='/srv/business-suite/shared/infra.env')
    parser.add_argument('--replace',action='store_true')
    args=parser.parse_args()
    try:
        if sys.stdin.isatty():
            raise ConfigurationError('Supply the private client JSON through stdin')
        raw=sys.stdin.buffer.read(65537)
        if len(raw)>65536:
            raise ConfigurationError('Client JSON exceeds the input limit')
        try: payload=json.loads(raw.decode('utf-8-sig'))
        except (ValueError,UnicodeError): raise ConfigurationError('Invalid client JSON') from None
        path=Path(args.env_file)
        if not path.is_absolute(): raise ConfigurationError('Use an absolute private environment path')
        configure(path,payload,args.replace)
    except ConfigurationError as error:
        print(str(error),file=sys.stderr);return 1
    except (OSError,ValueError,TypeError):
        print('Private configuration import failed; original configuration was not intentionally replaced',file=sys.stderr);return 1
    print('Google client configured privately. Values suppressed. Apply through the reviewed deployment pipeline.')
    return 0

if __name__=='__main__':
    raise SystemExit(main())