import { createAviationBot } from "./index";

const bot = createAviationBot();
await bot.start({
  onStart: (info) => {
    console.log(`Aviation Quiz Bot polling as @${info.username}`);
  }
});
