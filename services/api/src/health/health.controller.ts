import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AllergySeverity, ImmunisationSource, ImmunisationStatus } from '@prisma/client';
import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { AuditRead } from '../audit/audit-read';
import { HealthService } from './health.service';

class AddAllergyDto {
  @IsString() @MaxLength(200) allergen!: string;
  @IsIn(['MILD', 'MODERATE', 'SEVERE', 'ANAPHYLAXIS']) severity!: AllergySeverity;
  @IsOptional() @IsString() @MaxLength(2000) reaction?: string;
  @IsOptional() @IsString() @MaxLength(2000) actionPlan?: string;
  @IsOptional() @IsString() replacesId?: string;
}

class ReasonDto {
  @IsString() @MaxLength(600) reason!: string;
}

class AddImmunisationDto {
  @IsString() @MaxLength(200) vaccine!: string;
  @IsDateString({ strict: true }) doseDate!: string;
  @IsIn(['CERTIFICATE', 'AIR_STATEMENT', 'PARENT_DECLARED']) source!: ImmunisationSource;
}

class ImmunisationStatusDto {
  @IsIn(['UNKNOWN', 'UP_TO_DATE', 'CATCH_UP_PLAN', 'MEDICAL_EXEMPTION']) status!: ImmunisationStatus;
  @IsOptional() @IsString() statementDate?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

/** Safety-critical (always on): deliberately not behind a module guard. */
@UseGuards(JwtAuthGuard)
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('children/:childId/health')
  @AuditRead('health', { entityType: 'Child', idParam: 'childId' })
  getHealth(@Req() req: { user: RequestUser }, @Param('childId') childId: string, @Query('includeEnded') includeEnded?: string) {
    void includeEnded;
    return this.health.getHealth(req.user, childId);
  }

  @Post('children/:childId/allergies')
  addAllergy(@Req() req: { user: RequestUser }, @Param('childId') childId: string, @Body() dto: AddAllergyDto) {
    return this.health.addAllergy(req.user, childId, dto);
  }

  @Post('children/:childId/allergies/:allergyId/end')
  endAllergy(@Req() req: { user: RequestUser }, @Param('childId') childId: string, @Param('allergyId') allergyId: string, @Body() dto: ReasonDto) {
    return this.health.endAllergy(req.user, childId, allergyId, dto.reason);
  }

  @Post('children/:childId/immunisations')
  addImmunisation(@Req() req: { user: RequestUser }, @Param('childId') childId: string, @Body() dto: AddImmunisationDto) {
    return this.health.addImmunisation(req.user, childId, dto);
  }

  @Post('children/:childId/immunisations/:immunisationId/void')
  voidImmunisation(@Req() req: { user: RequestUser }, @Param('childId') childId: string, @Param('immunisationId') immunisationId: string, @Body() dto: ReasonDto) {
    return this.health.voidImmunisation(req.user, childId, immunisationId, dto.reason);
  }

  @Put('children/:childId/immunisation-status')
  setImmunisationStatus(@Req() req: { user: RequestUser }, @Param('childId') childId: string, @Body() dto: ImmunisationStatusDto) {
    return this.health.setImmunisationStatus(req.user, childId, dto);
  }

  @Get('health/allergy-register')
  @AuditRead('allergy-register')
  allergyRegister(@Req() req: { user: RequestUser }) {
    return this.health.allergyRegister(req.user);
  }
}
