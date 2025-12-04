import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	// 仅作为后台服务运行，不需要监听端口，但在开发模式下为了调试可能需要
	// 如果纯粹是 CronJob，可以 init 后不 listen，或者 listen 一个端口
	await app.listen(3000);
}
bootstrap();
