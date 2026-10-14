
import "dotenv/config";

import app from "./app";

const PORT = Number(process.env.PORT);

app.listen(PORT, () => {
  console.log(`CRI-PHY AI API running on http://localhost:${PORT}`);
});