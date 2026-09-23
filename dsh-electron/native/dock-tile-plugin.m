#import <AppKit/AppKit.h>

// Each edition needs a distinct Objective-C class in the shared Dock process.
@interface EDUWORK_DOCK_CLASS : NSObject <NSDockTilePlugIn>
@property(nonatomic, strong) NSDockTile *tile;
@property(nonatomic, strong) id terminationObserver;
@end

@implementation EDUWORK_DOCK_CLASS
- (NSBundle *)applicationBundle {
    NSURL *url = [NSBundle bundleForClass:self.class].bundleURL;
    for (int i = 0; i < 3; i++) url = url.URLByDeletingLastPathComponent;
    return [NSBundle bundleWithURL:url];
}

- (void)refreshIcon {
    if (!self.tile) return;
    NSBundle *plugin = [NSBundle bundleForClass:self.class];
    NSString *distribution = [plugin objectForInfoDictionaryKey:@"EduWorkDistribution"];
    NSURL *support = [[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
    NSURL *preference = [support URLByAppendingPathComponent:[distribution stringByAppendingString:@"-electron/browser/visual-style.json"]];
    NSData *data = [NSData dataWithContentsOfURL:preference];
    id value = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    BOOL blue = [value isKindOfClass:NSDictionary.class] && [value[@"style"] isEqual:@"dsh"];
    NSString *file = blue ? @"dock-blue-1024.png" : @"dock-red-1024.png";
    NSURL *imageURL = [[[self applicationBundle] resourceURL] URLByAppendingPathComponent:[@"brand" stringByAppendingPathComponent:file]];
    NSImage *image = [[NSImage alloc] initWithContentsOfURL:imageURL];
    if (!image) return;
    NSImageView *view = [[NSImageView alloc] initWithFrame:NSMakeRect(0, 0, self.tile.size.width, self.tile.size.height)];
    view.image = image;
    view.imageScaling = NSImageScaleProportionallyUpOrDown;
    self.tile.contentView = view;
    [self.tile display];
}

- (void)setDockTile:(NSDockTile *)dockTile {
    NSNotificationCenter *center = NSWorkspace.sharedWorkspace.notificationCenter;
    if (self.terminationObserver) [center removeObserver:self.terminationObserver];
    self.terminationObserver = nil;
    self.tile = dockTile;
    if (!dockTile) return;
    NSString *identifier = [self applicationBundle].bundleIdentifier;
    __weak typeof(self) weakSelf = self;
    // The running app owns its tile; reread the saved choice when it exits.
    self.terminationObserver = [center addObserverForName:NSWorkspaceDidTerminateApplicationNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
        NSRunningApplication *application = note.userInfo[NSWorkspaceApplicationKey];
        if ([application.bundleIdentifier isEqual:identifier]) [weakSelf refreshIcon];
    }];
    [self refreshIcon];
}

- (void)dealloc {
    if (_terminationObserver) [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:_terminationObserver];
}
@end
