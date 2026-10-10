// Internal server module; callable only through authenticated routes.

import { BigQuery } from "@google-cloud/bigquery";

let cachedClient = null;

export const getBigQueryClient = async () => {
  if (cachedClient) {
    return cachedClient;
  }

  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const clientEmail = process.env.BIGQUERY_CLIENT_EMAIL;
  const privateKey = process.env.BIGQUERY_PRIVATE_KEY
    ? process.env.BIGQUERY_PRIVATE_KEY.replace(/\\n/g, "\n")
    : undefined;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing BigQuery credentials. Set BIGQUERY_PROJECT_ID, BIGQUERY_CLIENT_EMAIL, and BIGQUERY_PRIVATE_KEY."
    );
  }

  cachedClient = new BigQuery({
    projectId,
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
  });

  return cachedClient;
};

