const fs = require('fs');
const initSqlJs = require('sql.js');

(async () => {
    const SQL = await initSqlJs();
    const dbPath = 'tmp/database.sqlite';
    const filebuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(filebuffer);
    
    // Check if the title exists
    const res = db.exec('SELECT id FROM library WHERE title LIKE \'%aughing%\'');
    if (!res || res.length === 0) {
        console.log('Video not found in AURA-V2 DB');
        return;
    }
    
    const meta = {
        tags: ['funny', 'parenting', 'school', 'humor', 'fails', 'kids', 'comedy', 'storytime', 'jokes']
    };
    const yt_title = `I Could Not Stop Laughing at My Daughter's School Incident 😂`;
    const description = `Parenting is full of surprises, but this school incident left me completely speechless and in tears laughing! You never know what kids are going to do or say next when they step into a classroom. Have you ever had an embarrassing or hilarious moment with your kids at school? Let me know in the comments below!

Don't forget to Subscribe for more hilarious parenting stories that prove kids are natural comedians!

#parenting #funnykids #schoolfails #storytime #comedy`;

    db.run(`UPDATE library SET title = ?, description = ?, metadata = ? WHERE title LIKE '%aughing%'`, [yt_title, description, JSON.stringify(meta)]);
    
    const dbBuffer = Buffer.from(db.export());
    fs.writeFileSync(dbPath, dbBuffer);
    console.log('[SUCCESS] Database successfully patched with dynamically generated metadata!');
})();
