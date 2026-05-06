import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ResultData } from '../../common/result/result';
import { TableSearchFilterDto } from '../../common/tableSearchDto';
import { Permission } from '../../decorators/permission.decorator';
import { AuthGuard } from '../../guards/auth.guard';
import { JwtGuard } from '../../guards/jwt.guard';
import {
  EnergyAddressFiltersDto,
  AgentRechargeOrderFiltersDto,
  CreateAgentRechargeOrderDto,
  BitcartInvoiceWebhookDto,
  EnergyOrderFiltersDto,
  EnergyPackageFiltersDto,
  EstimateEnergyPackageDto,
  CreateEnergyPackageDto,
  RunLinkTestDto,
  ReturnTaskFiltersDto,
  UpdateBotRuntimeStatusDto,
  UpdateEnergyOrderDto,
  UpdateEnergyPackageDto,
  UpdateAgentBotConfigDto,
  UpdatePlatformConfigDto,
  WalletTransactionFiltersDto,
} from './dto/energy-rental.dto';
import { EnergyRentalService } from './energy-rental.service';

@ApiTags('能量租赁')
@Controller('energy-rental')
export class EnergyRentalController {
  constructor(private readonly energyRentalService: EnergyRentalService) {}

  @Get('dashboard')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:dashboard')
  async getDashboard(@Req() req: { user?: { userId?: number } }) {
    const data = await this.energyRentalService.getDashboard(req.user?.userId);
    return ResultData.success(data);
  }

  @Post('packages/list')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:packages')
  async findPackages(
    @Body() searchParam: TableSearchFilterDto<EnergyPackageFiltersDto>,
    @Req() req: { user?: { userId?: number } },
  ) {
    const data = await this.energyRentalService.findPackages(
      searchParam,
      req.user?.userId,
    );
    return ResultData.success(data);
  }

  @Get('packages/platform-options')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:packages')
  async findPlatformPackageOptions() {
    const data = await this.energyRentalService.findPlatformPackageOptions();
    return ResultData.success(data);
  }

  @Post('platform-prices/list')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:platform-config')
  async findPlatformPrices(
    @Body() searchParam: TableSearchFilterDto<EnergyPackageFiltersDto>,
  ) {
    const data = await this.energyRentalService.findPlatformPrices(searchParam);
    return ResultData.success(data);
  }

  @Get('platform-prices/:id')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:platform-config')
  async findPlatformPrice(@Param('id', ParseIntPipe) id: number) {
    const data = await this.energyRentalService.findPlatformPrice(id);
    return ResultData.success(data);
  }

  @Post('platform-prices/create')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:platform-config:edit')
  async createPlatformPrice(@Body() createDto: CreateEnergyPackageDto) {
    const data = await this.energyRentalService.createPlatformPrice(createDto);
    return ResultData.success(data);
  }

  @Put('platform-prices/update')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:platform-config:edit')
  async updatePlatformPrice(@Body() updateDto: UpdateEnergyPackageDto) {
    const data = await this.energyRentalService.updatePlatformPrice(updateDto);
    return ResultData.success(data);
  }

  @Post('platform-prices/del')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:platform-config:edit')
  async removePlatformPrices(@Body() { ids }: { ids: number[] }) {
    const data = await this.energyRentalService.removePlatformPrices(ids);
    return ResultData.success(data);
  }

  @Get('packages/:id')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:packages')
  async findPackage(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: { userId?: number } },
  ) {
    const data = await this.energyRentalService.findPackage(
      id,
      req.user?.userId,
    );
    return ResultData.success(data);
  }

  @Post('packages/estimate')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:packages')
  async estimatePackage(
    @Body() estimateDto: EstimateEnergyPackageDto,
    @Req() req: { user?: { userId?: number } },
  ) {
    const data = await this.energyRentalService.estimatePackage(
      estimateDto,
      req.user?.userId,
    );
    return ResultData.success(data);
  }

  @Post('packages/create')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:packages:add')
  async createPackage(
    @Body() createDto: CreateEnergyPackageDto,
    @Req() req: { user?: { userId?: number } },
  ) {
    const data = await this.energyRentalService.createPackage(
      req.user?.userId,
      createDto,
    );
    return ResultData.success(data);
  }

  @Put('packages/update')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:packages:edit')
  async updatePackage(
    @Body() updateDto: UpdateEnergyPackageDto,
    @Req() req: { user?: { userId?: number } },
  ) {
    const data = await this.energyRentalService.updatePackage(
      req.user?.userId,
      updateDto,
    );
    return ResultData.success(data);
  }

  @Post('packages/del')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:packages:del')
  async removePackages(
    @Body() { ids }: { ids: number[] },
    @Req() req: { user?: { userId?: number } },
  ) {
    const data = await this.energyRentalService.removePackages(
      ids,
      req.user?.userId,
    );
    return ResultData.success(data);
  }

  @Post('orders/list')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:orders')
  async findOrders(
    @Body() searchParam: TableSearchFilterDto<EnergyOrderFiltersDto>,
    @Req() req: { user?: { userId?: number } },
  ) {
    const data = await this.energyRentalService.findOrders(
      searchParam,
      req.user?.userId,
    );
    return ResultData.success(data);
  }

  @Post('addresses/list')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:addresses')
  async findAddresses(
    @Body() searchParam: TableSearchFilterDto<EnergyAddressFiltersDto>,
    @Req() req: { user?: { userId?: number } },
  ) {
    const data = await this.energyRentalService.findAddresses(
      searchParam,
      req.user?.userId,
    );
    return ResultData.success(data);
  }

  @Get('orders/:id')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:orders')
  async findOrder(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: { userId?: number } },
  ) {
    const data = await this.energyRentalService.findOrder(id, req.user?.userId);
    return ResultData.success(data);
  }

  @Put('orders/update')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:orders:edit')
  async updateOrder(@Body() updateDto: UpdateEnergyOrderDto) {
    const data = await this.energyRentalService.updateOrder(updateDto);
    return ResultData.success(data);
  }

  @Post('wallet-transactions/list')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:wallet-transactions')
  async findWalletTransactions(
    @Body() searchParam: TableSearchFilterDto<WalletTransactionFiltersDto>,
    @Req() req: { user?: { userId?: number } },
  ) {
    const data =
      await this.energyRentalService.findWalletTransactions(
        searchParam,
        req.user?.userId,
      );
    return ResultData.success(data);
  }

  @Post('return-tasks/list')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:return-tasks')
  async findReturnTasks(
    @Body() searchParam: TableSearchFilterDto<ReturnTaskFiltersDto>,
  ) {
    const data = await this.energyRentalService.findReturnTasks(searchParam);
    return ResultData.success(data);
  }

  @Post('return-tasks/:id/retry')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:return-tasks:retry')
  async retryReturnTask(@Param('id', ParseIntPipe) id: number) {
    const data = await this.energyRentalService.retryReturnTask(id);
    return ResultData.success(data);
  }

  @Get('platform-config')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:platform-config')
  async getPlatformConfig() {
    const data = await this.energyRentalService.getPlatformConfig();
    return ResultData.success(data);
  }

  @Post('link-test/run')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:link-test')
  async runLinkTest(@Body() runDto: RunLinkTestDto) {
    const data = await this.energyRentalService.runLinkTest(runDto);
    return ResultData.success(data);
  }

  @Put('platform-config/update')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:platform-config:edit')
  async updatePlatformConfig(@Body() updateDto: UpdatePlatformConfigDto) {
    const data = await this.energyRentalService.updatePlatformConfig(updateDto);
    return ResultData.success(data);
  }

  @Get('agent-account')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:agent-recharge')
  async getAgentAccount(@Req() req: { user?: { userId?: number } }) {
    const data = await this.energyRentalService.getAgentAccount(
      req.user?.userId,
    );
    return ResultData.success(data);
  }

  @Get('agent-bot-config')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:bot-config')
  async getAgentBotConfig(@Req() req: { user?: { userId?: number } }) {
    const data = await this.energyRentalService.getAgentBotConfig(
      req.user?.userId,
    );
    return ResultData.success(data);
  }

  @Put('agent-bot-config/update')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:bot-config')
  async updateAgentBotConfig(
    @Body() updateDto: UpdateAgentBotConfigDto,
    @Req() req: { user?: { userId?: number } },
  ) {
    const data = await this.energyRentalService.updateAgentBotConfig(
      req.user?.userId,
      updateDto,
    );
    return ResultData.success(data);
  }

  @Get('bot-runtime/status')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:bot-config')
  async getBotRuntimeStatus(@Req() req: { user?: { userId?: number } }) {
    const data = await this.energyRentalService.getBotRuntimeStatus(
      req.user?.userId,
    );
    return ResultData.success(data);
  }

  @Put('bot-runtime/status')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:bot-config')
  async updateBotRuntimeStatus(
    @Body() updateDto: UpdateBotRuntimeStatusDto,
    @Req() req: { user?: { userId?: number } },
  ) {
    const data = await this.energyRentalService.updateBotRuntimeStatus(
      req.user?.userId,
      updateDto,
    );
    return ResultData.success(data);
  }

  @Post('agent-recharges/list')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:agent-recharge')
  async findAgentRechargeOrders(
    @Body() searchParam: TableSearchFilterDto<AgentRechargeOrderFiltersDto>,
    @Req() req: { user?: { userId?: number } },
  ) {
    const data = await this.energyRentalService.findAgentRechargeOrders(
      searchParam,
      req.user?.userId,
    );
    return ResultData.success(data);
  }

  @Post('agent-recharges/create')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:agent-recharge')
  async createAgentRechargeOrder(
    @Body() createDto: CreateAgentRechargeOrderDto,
    @Req() req: { user?: { userId?: number } },
  ) {
    const data = await this.energyRentalService.createAgentRechargeOrder(
      req.user?.userId,
      createDto,
    );
    return ResultData.success(data);
  }

  @Post('agent-recharges/:id/sync')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:agent-recharge')
  async syncAgentRechargeOrder(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: { userId?: number } },
  ) {
    const data = await this.energyRentalService.syncAgentRechargeOrder(
      id,
      req.user?.userId,
    );
    return ResultData.success(data);
  }

  @Post('bitcart/webhook')
  async handleBitcartWebhook(
    @Body() webhookDto: BitcartInvoiceWebhookDto,
    @Query('secret') secret?: string,
  ) {
    const data = await this.energyRentalService.handleBitcartInvoiceWebhook(
      webhookDto,
      secret,
    );
    return ResultData.success(data);
  }
}
