import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SiteSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  greeting?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  customPrompt?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  temperature?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  maxPages?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxDepth?: number;
}

export class CreateSiteDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsUrl({ require_protocol: true })
  url!: string;
}

export class UpdateSiteDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedOrigins?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => SiteSettingsDto)
  settings?: SiteSettingsDto;

  @IsOptional()
  @IsBoolean()
  autoSync?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  syncIntervalHours?: number;

  // monthlyMessageLimit and monthlyBudgetUsd are NOT exposed here on purpose:
  // they are platform operator quotas and are only edited from /admin.
}
