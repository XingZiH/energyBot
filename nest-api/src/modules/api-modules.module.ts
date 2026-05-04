import { Module } from '@nestjs/common';
import { UserModule } from './user/user.module';
import { RoleModule } from './role/role.module';
import { DepartmentModule } from './department/department.module';
import { MenuModule } from './menu/menu.module';
import { PermissionModule } from './permission/permission.module';
import { EnergyRentalModule } from './energy-rental/energy-rental.module';
import { CustomerModule } from './customer/customer.module';
import { LicenseModule } from './license/license.module';
import { MyLicenseModule } from './my-license/my-license.module';
import { AgentModule } from './agent/agent.module';

@Module({
  imports: [
    UserModule,
    RoleModule,
    DepartmentModule,
    MenuModule,
    PermissionModule,
    EnergyRentalModule,
    CustomerModule,
    LicenseModule,
    MyLicenseModule,
    AgentModule,
  ],
})
export class ApiModulesModule {}
