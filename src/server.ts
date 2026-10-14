import { env } from "./config/env";
import app from "./app";

app.listen(env.PORT, () => {
  console.log(
    `CRI-PHY AI API running on http://localhost:${env.PORT}`
  );
});