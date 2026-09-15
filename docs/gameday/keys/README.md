# Gameday keys

`gameday_orin.pub` is the **public** half of a dedicated, revocable SSH key authorized on the Orin
(`vanguard@192.168.55.1`) for the event. Public keys are safe to commit — they grant nothing on
their own.

- The matching **private** key lives only on the lead laptop at `~/.ssh/gameday_orin`. It is **never**
  committed — no private key, and no password, ever goes in this repo.
- It exists so gameday SSH is password-free without spreading a personal key around.

## Revoke it after the event
On the Orin, remove the matching line from `~/.ssh/authorized_keys`:

```
ssh vanguard@192.168.55.1 "grep -v 'gameday-orin' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.tmp && mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys"
```

## If the gameday laptop is a fresh machine that doesn't have the private key
The private key must be present at `~/.ssh/gameday_orin` on the machine wired to the Orin. With no
USB available, put it there by pasting its contents into that laptop's terminal once (open the file
on the prepared laptop, copy it, paste into the fresh one), then `chmod 600 ~/.ssh/gameday_orin`.
Do not email it, and do not commit it.
