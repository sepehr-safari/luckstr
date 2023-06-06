const fs = require('fs');

function createVercelJSON() {
  const content = {
    crons: [
      {
        path: `/api/v1/publish?key=${process.env.CRON_JOB_KEY}`,
        schedule: '0 19 * * *',
      },
      {
        path: `/api/v1/draw?key=${process.env.CRON_JOB_KEY}`,
        schedule: '0 18 * * *',
      },
    ],
  };

  const filePath = 'vercel.json';

  fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
}

createVercelJSON();
