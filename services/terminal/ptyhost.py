"""Gives a child process a real pseudo-terminal, without native Node modules (no node-pty build).

stdin  -> bytes typed in the browser
stdout <- terminal output
fd 3   -> resize commands, one "cols rows" per line
Usage: python3 -I ptyhost.py <command> [args...]
"""
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

CTL = 3


def write_all(fd, data):
    while data:
        n = os.write(fd, data)
        data = data[n:]


def set_size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def main():
    argv = sys.argv[1:] or ["bash", "-l"]
    pid, master = pty.fork()
    if pid == 0:
        os.closerange(3, 256)
        os.execvp(argv[0], argv)
    set_size(master, int(os.environ.get("COLS", "100")), int(os.environ.get("ROWS", "30")))
    watch = [0, master, CTL]
    pending = b""
    try:
        while True:
            ready, _, _ = select.select(watch, [], [])
            if master in ready:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    break
                if not data:
                    break
                write_all(1, data)
            if 0 in ready:
                data = os.read(0, 65536)
                if not data:
                    break
                write_all(master, data)
            if CTL in ready:
                data = os.read(CTL, 1024)
                if not data:
                    watch.remove(CTL)
                    continue
                pending += data
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    try:
                        cols, rows = (max(2, min(500, int(x))) for x in line.split())
                    except ValueError:
                        continue
                    set_size(master, cols, rows)
                    os.kill(pid, signal.SIGWINCH)
    finally:
        try:
            os.kill(pid, signal.SIGHUP)
            os.waitpid(pid, 0)
        except OSError:
            pass


if __name__ == "__main__":
    main()
