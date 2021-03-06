import * as _ from "lodash";
import {Observable, ReplaySubject} from "rx";
import {basename, dirname, normalize} from "path";
import {Solution} from "./solution";

const projectFactories: { [key: string]: { new (project: any, solutionPath: string); }; } = {
    MsBuildProject: <any>MsBuildProjectViewModel,
    DnxProject: <any>DnxProjectViewModel
};

const supportedProjectTypes = _.keys(projectFactories);
export function projectViewModelFactory(omnisharpProject: OmniSharp.Models.ProjectInformationResponse, solutionPath: string) {
    var projectTypes = _.filter(supportedProjectTypes, type => _.has(omnisharpProject, type));
    var missing = _.difference(_.keys(omnisharpProject), supportedProjectTypes);
    if (missing.length) {
        console.log(`Missing factory for project type ${missing}`);
    }

    var results: ProjectViewModel<any>[] = []
    _.each(projectTypes, projectType => {
        if (projectType && projectFactories[projectType]) {
            results.push(new projectFactories[projectType](omnisharpProject[projectType], solutionPath));
        }
    });
    return results;
}

const workspaceFactories: { [key: string]: (workspace: any, solutionPath: string) => ProjectViewModel<any>[] } = {
    MsBuild: (workspace: OmniSharp.Models.MsBuildWorkspaceInformation, solutionPath: string) => {
        return _.map(workspace.Projects, projectInformation => new MsBuildProjectViewModel(projectInformation, solutionPath));
    },
    Dnx: (workspace: OmniSharp.Models.DnxWorkspaceInformation, solutionPath: string) => {
        return _.map(workspace.Projects, projectInformation => new DnxProjectViewModel(projectInformation, solutionPath));
    },
    ScriptCs: (workspace: OmniSharp.ScriptCs.ScriptCsContext, solutionPath: string) => {
        if (workspace.CsxFiles.length > 0)
            return [new ScriptCsProjectViewModel(workspace, solutionPath)];
        return [];
    },
};

const supportedWorkspaceTypes = _.keys(projectFactories);
export function workspaceViewModelFactory(omnisharpWorkspace: OmniSharp.Models.WorkspaceInformationResponse, solutionPath: string) {
    var projects = [];
    _.forIn(omnisharpWorkspace, (item, key) => {
        var factory = workspaceFactories[key];
        if (factory) {
            projects.push(...factory(item, solutionPath));
        }
    });

    return projects;
}

export abstract class ProjectViewModel<T> implements OmniSharp.IProjectViewModel {
    constructor(project: T, solutionPath: string) {
        this.solutionPath = solutionPath;
        this.init(project);
        this.observe = { activeFramework: this._subjectActiveFramework };
        this._subjectActiveFramework.onNext(this._frameworks[0]);
    }

    private _name: string;
    public get name() { return this._name; }
    public set name(value) { this._name = value; }

    private _path: string;
    public get path() { return this._path; }
    public set path(value) { this._path = value; }

    private _solutionPath: string;
    public get solutionPath() { return this._solutionPath; }
    public set solutionPath(value) { this._solutionPath = value; }

    private _sourceFiles: string[] = [];
    public get sourceFiles() { return this._sourceFiles; }
    public set sourceFiles(value) {
        this._sourceFiles = value || [];
        if (this._filesSet) this._filesSet = null;
    }

    private _filesSet: Set<string>;
    public get filesSet() {
        if (!this._filesSet) {
            this._filesSet = new Set<string>();
            _.each(this._sourceFiles, file => this._filesSet.add(file));
        }
        return this._filesSet;
    }

    private _subjectActiveFramework = new ReplaySubject<OmniSharp.Models.DnxFramework>(1);
    private _activeFramework: OmniSharp.Models.DnxFramework;
    public get activeFramework() { return this._activeFramework; }
    public set activeFramework(value) {
        this._activeFramework = value;
        !this._subjectActiveFramework.isDisposed && this._subjectActiveFramework.onNext(this._activeFramework);
    }

    private _frameworks: OmniSharp.Models.DnxFramework[] = [{ FriendlyName: 'All', Name: 'all', ShortName: 'all' }];
    public get frameworks() { return this._frameworks; }
    public set frameworks(value) {
        this._frameworks = [{ FriendlyName: 'All', Name: 'all', ShortName: 'all' }].concat(value);
        if (!this.activeFramework) {
            this.activeFramework = this._frameworks[0];
        }
    }

    private _configurations: string[] = [];
    public get configurations() { return this._configurations; }
    public set configurations(value) { this._configurations = value || []; }

    private _commands: { [key: string]: string } = {};
    public get commands() { return this._commands; }
    public set commands(value) { this._commands = value || {}; }

    public observe: {
        activeFramework: Observable<OmniSharp.Models.DnxFramework>;
    };

    public abstract init(value: T);
    public update(other: ProjectViewModel<T>) {
        this.name = other.name;
        this.path = other.path;
        this.solutionPath = other.solutionPath;
        this.sourceFiles = other.sourceFiles;
        this.frameworks = other.frameworks;
        this.activeFramework = this._activeFramework;
        this.configurations = other.configurations
        this.commands = other.commands;
    }

    public toJSON() {
        var {name, path, solutionPath, sourceFiles, frameworks, configurations, commands} = this;
        return { name, path, solutionPath, sourceFiles, frameworks, configurations, commands };
    }

    public dispose() {
        this._subjectActiveFramework.dispose();
    }
}

class ProxyProjectViewModel extends ProjectViewModel<ProjectViewModel<any>> {
    public init(project: ProjectViewModel<any>) {
        this.update(project);
    }
}

class MsBuildProjectViewModel extends ProjectViewModel<OmniSharp.Models.MSBuildProject> {
    public init(project: OmniSharp.Models.MSBuildProject) {
        var frameworks = [{
            FriendlyName: project.TargetFramework,
            Name: project.TargetFramework,
            ShortName: project.TargetFramework
        }];

        this.name = project.AssemblyName;
        this.path = project.Path;
        this.frameworks = frameworks;
        this.sourceFiles = project.SourceFiles;
    }
}

class DnxProjectViewModel extends ProjectViewModel<OmniSharp.Models.DnxProject> {
    public init(project: OmniSharp.Models.DnxProject) {
        this.name = project.Name;
        this.path = project.Path;
        this.frameworks = project.Frameworks;
        this.configurations = project.Configurations;
        this.commands = project.Commands;
        this.sourceFiles = project.SourceFiles;
    }
}

class ScriptCsProjectViewModel extends ProjectViewModel<OmniSharp.ScriptCs.ScriptCsContext> {
    public init(project: OmniSharp.ScriptCs.ScriptCsContext) {
        this.name = 'ScriptCs';
        this.path = project.Path;
        this.sourceFiles = project.CsxFiles;
    }
}
