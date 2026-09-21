---
name: replies
description: Reads the reply emails the human dropped into workspace/prospecting/inbox/ (.eml files), updates the leads, respects opt-outs, and summarizes what to do next. Use when the human types "replies".
---

# Replies

Role: **sales**.

1. `node tools/replies.mjs --as sales`. The script matches each reply to a lead, marks it `replied`
   (or `do_not_contact` if the person asked to stop), and adds the reply to the account file.
2. If nothing is in the inbox, explain how to add replies: save or drag the email as a `.eml` file into
   `workspace/prospecting/inbox/` (Apple Mail, Outlook, Thunderbird: drag the message into the folder;
   Gmail: "Download message").
3. For each replied lead, read the reply in the account file and propose ONE next step to the human
   (answer draft, meeting brief, stop). Do not draft an answer before the human chooses.
4. Unmatched replies: list the sender and ask the human which lead it belongs to.
