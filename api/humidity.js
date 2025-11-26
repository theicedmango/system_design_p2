import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

// Reuse a single MongoClient across calls
let client;
let clientPromise;

async function getCollection() {
  if (!clientPromise) {
    client = new MongoClient(uri);
    clientPromise = client.connect();
  }

  const conn = await clientPromise;
  const db = conn.db("humidity_app");       // database name
  return db.collection("readings");         // collection name
}

async function seedFakeData(collection, days) {
  const now = new Date();
  const docs = [];

  for (let i = days; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const humidity = 40 + Math.round(Math.random() * 30); // 40–70%
    docs.push({
      city: "Toronto",
      humidity,
      timestamp: t
    });
  }

  if (docs.length > 0) {
    await collection.insertMany(docs);
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const method = request.method;
    const range = url.searchParams.get("range") || "week";
    const collection = await getCollection();

    if (method === "GET") {
      const ranges = { week: 7, month: 30, quarter: 90 };
      const days = ranges[range] || 7;

      const now = new Date();
      const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      let docs = await collection
        .find({ city: "Toronto", timestamp: { $gte: since } })
        .sort({ timestamp: 1 })
        .toArray();

      if (docs.length === 0) {
        await seedFakeData(collection, days);
        docs = await collection
          .find({ city: "Toronto", timestamp: { $gte: since } })
          .sort({ timestamp: 1 })
          .toArray();
      }

      const labels = docs.map((doc) =>
        doc.timestamp.toISOString().split("T")[0]
      );
      const series = docs.map((doc) => doc.humidity);

      const avg =
        series.length > 0
          ? Math.round(series.reduce((a, b) => a + b, 0) / series.length)
          : 0;
      const high = series.length > 0 ? Math.max(...series) : 0;
      const low = series.length > 0 ? Math.min(...series) : 0;

      return new Response(
        JSON.stringify({ labels, series, avg, high, low }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }

    if (method === "POST") {
      const body = await request.json().catch(() => null);
      const humidity = body?.humidity;
      const city = body?.city || "Toronto";

      if (typeof humidity !== "number") {
        return new Response(
          JSON.stringify({ error: "humidity must be a number" }),
          {
            status: 400,
            headers: { "content-type": "application/json" }
          }
        );
      }

      const doc = { city, humidity, timestamp: new Date() };
      await collection.insertOne(doc);

      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "content-type": "application/json" }
      });
    }

    if (method === "DELETE") {
      await collection.deleteMany({ city: "Toronto" });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    return new Response("Method Not Allowed", { status: 405 });
  }
};
