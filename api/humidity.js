import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

// Reuse a single MongoClient across calls
let client;
let clientPromise;

async function getCollection() {
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }

  if (!clientPromise) {
    client = new MongoClient(uri);
    clientPromise = client.connect();
  }

  const conn = await clientPromise;
  const db = conn.db("humidity_app");     // database name
  return db.collection("readings");       // collection name
}

// Seed fake historic data for Toronto, one reading per past day
async function seedFakeData(collection, days) {
  const now = new Date();
  const docs = [];

  for (let i = days; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const humidity = 40 + Math.round(Math.random() * 30); // 40–70%

    docs.push({
      city: "Toronto",
      humidity,
      source: "seed",
      timestamp: t
    });
  }

  if (docs.length > 0) {
    await collection.insertMany(docs);
  }
}

export default async function handler(req, res) {
  try {
    const { method, query } = req;
    const range = query.range || "week";
    const mode = query.mode || null;

    const collection = await getCollection();

    // 1) Latest reading for the widget UI
    if (method === "GET" && mode === "latest") {
      const latest = await collection
        .find({})
        .sort({ timestamp: -1 })
        .limit(1)
        .toArray();

      if (!latest.length) {
        return res.status(404).json({ error: "No readings found" });
      }

      const doc = latest[0];

      return res.status(200).json({
        humidity: doc.humidity,
        city: doc.city,
        source: doc.source || "unknown",
        timestamp: doc.timestamp
      });
    }

    // 2) History for the modal chart (week / month / quarter)
    if (method === "GET") {
      const ranges = { week: 7, month: 30, quarter: 90 };
      const days = ranges[range] || 7;

      const now = new Date();
      const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      // Read existing docs for Toronto in the requested range
      let docs = await collection
        .find({ city: "Toronto", timestamp: { $gte: since } })
        .sort({ timestamp: 1 })
        .toArray();

      // If we do not have enough data points for this range,
      // seed fake historic data once.
      if (docs.length < days) {
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

      return res.status(200).json({ labels, series, avg, high, low });
    }

    // 3) Insert new reading (used by ESP32 and optionally widget)
    if (method === "POST") {
      const body = req.body || {};
      const humidity = body.humidity;
      const city = body.city || "Toronto";
      const source = body.source || "unknown";

      if (typeof humidity !== "number") {
        return res
          .status(400)
          .json({ error: "humidity must be a number" });
      }

      const doc = { city, humidity, source, timestamp: new Date() };
      await collection.insertOne(doc);

      return res.status(201).json({ ok: true });
    }

    // 4) Clear readings (dev only)
    if (method === "DELETE") {
      await collection.deleteMany({ city: "Toronto" });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", ["GET", "POST", "DELETE"]);
    return res.status(405).end("Method Not Allowed");
  } catch (err) {
    console.error("API /api/humidity error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
