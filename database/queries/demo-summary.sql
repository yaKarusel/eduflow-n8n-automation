SELECT 'contacts' AS entity,count(*) FROM contacts
UNION ALL SELECT 'leads',count(*) FROM leads
UNION ALL SELECT 'messages',count(*) FROM messages
UNION ALL SELECT 'comments',count(*) FROM comments
UNION ALL SELECT 'content_items',count(*) FROM content_items
UNION ALL SELECT 'publications',count(*) FROM publications
UNION ALL SELECT 'errors',count(*) FROM error_logs
ORDER BY entity;
