# Auth Testing Playbook (DT Inspection)

Auth is Bearer-token based (JWT, HS256, 12h). Login returns `access_token` in body; frontend stores it in localStorage `dt_token` and sends `Authorization: Bearer`. `?auth=<token>` query is also accepted (for image tags).

## Step 1: MongoDB
```
mongosh
use test_database
db.users.find({}, {email:1, role:1, site_id:1}).pretty()
db.users.findOne({role: "superadmin"}, {password_hash: 1})   # hash starts with $2b$
db.users.getIndexes()   # unique index on email
```

## Step 2: API
```
API=http://localhost:8001/api
TOKEN=$(curl -s -X POST $API/auth/login -H "Content-Type: application/json" -d '{"email":"admin@iti.demo","password":"Admin@1234"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s $API/auth/me -H "Authorization: Bearer $TOKEN"
curl -s -o /dev/null -w "%{http_code}" $API/auth/me                    # 401
curl -s -X POST $API/auth/login -H "Content-Type: application/json" -d '{"email":"admin@iti.demo","password":"wrong"}'   # 401
```

## Role matrix
- superadmin: everything; must pass `site_id` on trucks/categories/items/recap
- admin: own site only; users -> drivers only; recap allowed
- driver: checklist, create inspection, list/view own inspections; 403 on masters write, users, recap
