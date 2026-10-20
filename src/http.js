export const error = (status, message) => Response.json({ error: message }, { status });
