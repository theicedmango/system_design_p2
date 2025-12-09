// pages/api/humidity.js

import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

// Reuse a single Mongo client across requests
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
  const db = conn.db("humidity_app");        // database name
  return db.collection("readings");          // collection name
}

// Helper to compute stats from a numeric array
function computeStats(series) {
  if (!series.length) {
    return { avg: 0, high: 0, low: 0 };
  }

  const sum = series.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / series.length);
  const high = Math.round(Math.max(...series));
  const low = Math.round(Math.min(...series));

  return { avg, high, low };
}

export default async function handler(req, res) {
  try {
    const collection = await getCollection();
    const { method } = req;

    if (method === "GET") {
      // Expected query: ?city=Sensor&range=week|month|quarter
      const { city = "Sensor", range = "week" } = req.query;

      const ranges = { week: 7, month: 30, quarter: 90 };
      const days = ranges[range] || 7;

      const now = new Date();
      const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      const filter = {
        city,
        timestamp: { $gte: since },
      };

      const docs = await collection
        .find(filter)
        .sort({ timestamp: 1 })
        .toArray();

      // Build labels and series for the chart
      const labels = docs.map((doc) =>
        doc.timestamp.toISOString().split("T")[0]
      );
      const series = docs.map((doc) => doc.humidity);

      const { avg, high, low } = computeStats(series);

      return res.status(200).json({ labels, series, avg, high, low });
    }

    if (method === "POST") {
      // Body is expected to be JSON: { city, humidity, source }
      const body = req.body || {};
      const humidity = body.humidity;

      if (typeof humidity !== "number") {
        return res
          .status(400)
          .json({ error: "humidity must be a number" });
      }

      const city = body.city || "Sensor";
      const source = body.source || "unknown";

      const doc = {
        city,
        humidity,
        source,
        timestamp: new Date(),
      };

      await collection.insertOne(doc);
      return res.status(201).json({ ok: true });
    }

    if (method === "DELETE") {
      // Optional dev tool: clear readings for a specific city or all
      const { city } = req.query;

      const filter = city ? { city } : {};
      await collection.deleteMany(filter);

      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", ["GET", "POST", "DELETE"]);
    return res.status(405).end("Method Not Allowed");
  } catch (err) {
    console.error("API /api/humidity error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
