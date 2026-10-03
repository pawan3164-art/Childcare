import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { ChildrenService } from './children.service';
import { ChildrenController } from './children.controller';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  providers: [RoomsService, ChildrenService, UsersService],
  controllers: [RoomsController, ChildrenController, UsersController],
  exports: [RoomsService, ChildrenService, UsersService],
})
export class CentreAdminModule {}
