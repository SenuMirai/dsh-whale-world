"""Reject stale or partial dependency snapshots before a message cursor can advance."""
import os
from pathlib import Path


class SnapshotBusy(RuntimeError):
    pass


def fileStamp(path):
    try:
        stat = Path(path).stat()
    except FileNotFoundError as error:
        raise SnapshotBusy('微信快照文件正在变化') from error
    return stat.st_mtime, stat.st_size


def checkedSnapshot(database, rel, openSnapshot):
    connection = openSnapshot(rel)
    try:
        stampFile = Path(database.workdir, rel.replace(os.sep, '__') + '.stamp')
        stamp = stampFile.read_text().split(',')
        source = fileStamp(database._db_path(rel))
        wal = database._wal_path(rel)
        walStamp = fileStamp(wal) if wal else (0.0, 0)
        if len(stamp) != 6 or int(stamp[5]) < 0 or (float(stamp[1]), int(stamp[2])) != source or (float(stamp[3]), int(stamp[4])) != walStamp:
            stampFile.unlink()
            raise SnapshotBusy('微信数据库快照不完整或已过期，本轮不推进消息位置')
        return connection
    except Exception:
        connection.close()
        raise
