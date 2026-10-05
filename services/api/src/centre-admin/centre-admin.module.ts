import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { ChildrenService } from './children.service';
import { ChildrenController } from './children.controller';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { CentreSettingsService } from './centre-settings.service';
import { CentreSettingsController } from './centre-settings.controller';

@Module({
  providers: [RoomsService, ChildrenService, UsersService, CentreSettingsService],
  controllers: [RoomsController, ChildrenController, UsersController, CentreSettingsController],
  exports: [RoomsService, ChildrenService, UsersService],
})
export class CentreAdminModule {}
