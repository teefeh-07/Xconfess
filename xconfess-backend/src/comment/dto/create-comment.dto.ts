import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;

  @IsString()
  @IsNotEmpty()
  anonymousContextId: string;

  /**
   * If provided, this comment is a reply to the given comment ID.
   * Only one level of nesting is supported — replies to replies are rejected.
   */
  @IsOptional()
  @IsNumber()
  parentId?: number;
}
