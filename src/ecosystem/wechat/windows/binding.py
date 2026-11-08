"""Rediscover only the configured account; every live binding pins its process lifetime."""
from pathlib import Path
import psutil


class WechatOffline(RuntimeError):
    pass


def processAccounts(process, config):
    root = Path(config['dbDir']).resolve()
    accounts = set()
    for item in process.open_files():
        try:
            parts = Path(item.path).resolve().relative_to(root).parts
        except ValueError:
            continue
        if len(parts) >= 3 and parts[1].lower() == 'db_storage':
            accounts.add(parts[0])
    return accounts


def checkAccountProcess(process, config, started):
    try:
        if process.create_time() != started or process.name().lower() != 'weixin.exe':
            raise WechatOffline('原微信进程已退出或变化')
        if processAccounts(process, config) != {config['account']}:
            raise WechatOffline('原进程已不再独占绑定的微信账号')
    except (psutil.NoSuchProcess, psutil.ZombieProcess) as error:
        raise WechatOffline('原微信进程已退出') from error


def findAccountProcess(config, processes=None):
    provided = processes is not None
    if processes is None:
        processes = (process for process in psutil.process_iter(['name']) if (process.info['name'] or '').lower() == 'weixin.exe')
    matches = []
    for candidate in processes:
        try:
            # A fresh Process avoids carrying cached creation times across PID reuse.
            process = candidate if provided else psutil.Process(candidate.pid)
            if process.name().lower() != 'weixin.exe': continue
            accounts = processAccounts(process, config)
            if config['account'] not in accounts: continue
            if accounts != {config['account']}:
                raise RuntimeError('同一微信进程持有多个账号，禁止自动绑定')
            matches.append(process)
        except (psutil.NoSuchProcess, psutil.ZombieProcess):
            continue
    if len(matches) > 1: raise RuntimeError('绑定账号对应多个微信进程，禁止猜测')
    if not matches: raise WechatOffline('尚未发现已登录的指定微信账号')
    return matches[0]
