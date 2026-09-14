const { MongoClient } = require('mongodb');
const candidates = require('../candidates_data.json');

const uri = 'mongodb+srv://brandsetudigital_db_user:iZkej1R6Q6XGUw35@wathsappautomation.s7wfrzv.mongodb.net/Aotumation?retryWrites=true&w=majority&appName=WathsappAutomation';

async function seedMongo() {
  console.log('Connecting to MongoDB Atlas...');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('Aotumation');
  const col = db.collection('Brandsetu Digital');

  console.log(`Seeding ${candidates.length} candidates into MongoDB Atlas collection "Brandsetu Digital"...`);
  for (const c of candidates) {
    const doc = { ...c, _id: c.id };
    await col.updateOne(
      { phone: c.phone },
      { $set: doc },
      { upsert: true }
    );
  }

  const total = await col.countDocuments();
  console.log(`🎉 SUCCESS! Total candidates in MongoDB Atlas: ${total}`);
  await client.close();
}

seedMongo().catch(console.error);
