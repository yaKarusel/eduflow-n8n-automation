SELECT l.id,c.username,l.intent,l.score,l.status,l.campaign,l.updated_at
FROM leads l JOIN contacts c ON c.id=l.contact_id
WHERE l.status IN ('HOT','MANAGER_ASSIGNED')
ORDER BY l.score DESC,l.updated_at DESC;
