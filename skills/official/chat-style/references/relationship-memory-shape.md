# Relationship Memory Shape

Use this reference when connecting chat style to a future memory layer.

## Person Record

- `person_id`
- names and aliases
- platform identities: WeChat, WhatsApp, email, phone, social handles
- relationship type and closeness
- durable facts
- shared context
- open loops, plans, promises, and unresolved questions
- style notes for this person
- approved examples and rejected/edited examples

## Retrieval For Replies

Retrieve:

1. latest active-platform messages
2. facts/open loops for the same person
3. relevant cross-platform context when it changes the reply
4. recent outgoing messages from the user to this person
5. edit examples for similar message type and relationship

Avoid retrieving unrelated messages just because they are semantically similar. For style, authorship and relationship match matter more than topic match.
