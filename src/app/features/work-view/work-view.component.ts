import {
  AfterContentInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { TaskService } from '../tasks/task.service';
import { expandAnimation, expandFadeAnimation } from '../../ui/animations/expand.ani';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { TakeABreakService } from '../take-a-break/take-a-break.service';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  from,
  fromEvent,
  Observable,
  ReplaySubject,
  Subscription,
  timer,
  zip,
} from 'rxjs';
import { TaskWithSubTasks } from '../tasks/task.model';
import { delay, filter, map, switchMap } from 'rxjs/operators';
import { fadeAnimation } from '../../ui/animations/fade.ani';
import { PlanningModeService } from '../planning-mode/planning-mode.service';
import { T } from '../../t.const';
import { ImprovementService } from '../metric/improvement/improvement.service';
import { workViewProjectChangeAnimation } from '../../ui/animations/work-view-project-change.ani';
import { WorkContextService } from '../work-context/work-context.service';
import { ProjectService } from '../project/project.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { RightPanelComponent } from '../right-panel/right-panel.component';
import { CdkDropListGroup } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatFabButton, MatMiniFabButton } from '@angular/material/button';
import { ImprovementBannerComponent } from '../metric/improvement-banner/improvement-banner.component';
import { AddTaskBarComponent } from '../tasks/add-task-bar/add-task-bar.component';
import { AddScheduledTodayOrTomorrowBtnComponent } from '../add-tasks-for-tomorrow/add-scheduled-for-tomorrow/add-scheduled-today-or-tomorrow-btn.component';
import { TaskListComponent } from '../tasks/task-list/task-list.component';
import { SplitComponent } from './split/split.component';
import { BacklogComponent } from './backlog/backlog.component';
import { AsyncPipe } from '@angular/common';
import { MsToStringPipe } from '../../ui/duration/ms-to-string.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { flattenTasks } from '../tasks/store/task.selectors';

@Component({
  selector: 'work-view',
  templateUrl: './work-view.component.html',
  styleUrls: ['./work-view.component.scss'],
  animations: [
    expandFadeAnimation,
    expandAnimation,
    fadeAnimation,
    workViewProjectChangeAnimation,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RightPanelComponent,
    CdkDropListGroup,
    CdkScrollable,
    MatTooltip,
    MatIcon,
    MatMiniFabButton,
    ImprovementBannerComponent,
    MatButton,
    RouterLink,
    AddTaskBarComponent,
    AddScheduledTodayOrTomorrowBtnComponent,
    TaskListComponent,
    SplitComponent,
    BacklogComponent,
    MatFabButton,
    AsyncPipe,
    MsToStringPipe,
    TranslatePipe,
  ],
})
export class WorkViewComponent implements OnInit, OnDestroy, AfterContentInit {
  taskService = inject(TaskService);
  takeABreakService = inject(TakeABreakService);
  planningModeService = inject(PlanningModeService);
  improvementService = inject(ImprovementService);
  layoutService = inject(LayoutService);
  workContextService = inject(WorkContextService);
  private _activatedRoute = inject(ActivatedRoute);
  private _projectService = inject(ProjectService);
  private _cd = inject(ChangeDetectorRef);

  // TODO refactor all to signals
  undoneTasks = input<TaskWithSubTasks[]>([]);
  doneTasks = input<TaskWithSubTasks[]>([]);
  backlogTasks = input<TaskWithSubTasks[]>([]);
  isShowBacklog = input<boolean>(false);

  isPlanningMode = toSignal(this.planningModeService.isPlanningMode$);
  todayRemainingInProject = toSignal(this.workContextService.todayRemainingInProject$);
  estimateRemainingToday = toSignal(this.workContextService.estimateRemainingToday$);
  workingToday = toSignal(this.workContextService.workingToday$);
  selectedTaskId = toSignal(this.taskService.selectedTaskId$);

  isShowTimeWorkedWithoutBreak: boolean = true;
  splitInputPos: number = 100;
  T: typeof T = T;

  // NOTE: not perfect but good enough for now
  isTriggerBacklogIconAni$: Observable<boolean> =
    this._projectService.onMoveToBacklog$.pipe(
      switchMap(() => zip(from([true, false]), timer(1, 200))),
      map((v) => v[0]),
    );
  splitTopEl$: ReplaySubject<HTMLElement> = new ReplaySubject(1);

  // TODO make this work for tag page without backlog
  upperContainerScroll$: Observable<Event> =
    this.workContextService.isContextChanging$.pipe(
      filter((isChanging) => !isChanging),
      delay(50),
      switchMap(() => this.splitTopEl$),
      switchMap((el) => fromEvent(el, 'scroll')),
    );

  private _subs: Subscription = new Subscription();
  private _switchListAnimationTimeout?: number;

  // TODO: Skipped for migration because:
  //  Accessor queries cannot be migrated as they are too complex.
  @ViewChild('splitTopEl', { read: ElementRef }) set splitTopElRef(ref: ElementRef) {
    if (ref) {
      this.splitTopEl$.next(ref.nativeElement);
    }
  }

  constructor() {
    // Setup effect to track task changes
    effect(() => {
      const currentSelectedId = this.selectedTaskId();
      if (!currentSelectedId) return;

      const undoneArr = flattenTasks(this.undoneTasks());
      if (undoneArr.some((t) => t.id === currentSelectedId)) return;

      const doneArr = flattenTasks(this.doneTasks());
      if (doneArr.some((t) => t.id === currentSelectedId)) return;

      // if task really is gone
      this.taskService.setSelectedId(null);
    });
  }

  ngOnInit(): void {
    // preload
    // TODO check
    // this._subs.add(this.workContextService.backlogTasks$.subscribe());

    this._subs.add(
      this._activatedRoute.queryParams.subscribe((params) => {
        if (params && params.backlogPos) {
          this.splitInputPos = +params.backlogPos;
        } else if (params.isInBacklog === 'true') {
          this.splitInputPos = 50;
        }
        // NOTE: otherwise this is not triggered right away
        this._cd.detectChanges();
      }),
    );
  }

  ngAfterContentInit(): void {
    this._subs.add(
      this.upperContainerScroll$.subscribe(({ target }) => {
        if ((target as HTMLElement).scrollTop !== 0) {
          this.layoutService.isScrolled$.next(true);
        } else {
          this.layoutService.isScrolled$.next(false);
        }
      }),
    );
  }

  ngOnDestroy(): void {
    if (this._switchListAnimationTimeout) {
      window.clearTimeout(this._switchListAnimationTimeout);
    }
    this.layoutService.isScrolled$.next(false);
  }

  planMore(): void {
    this.planningModeService.enterPlanningMode();
  }

  startWork(): void {
    this.planningModeService.leavePlanningMode();
  }

  resetBreakTimer(): void {
    this.takeABreakService.resetTimer();
  }
}
